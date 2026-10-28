import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { companionCommand } from './companion-control.mjs';
const exec = promisify(execFile);
export const powerHelper = '/Library/Application Support/MacUnlock/power-control';
const run = async (file, args) => (await exec(file, args, { timeout: 5000, maxBuffer: 65536 })).stdout;
export function parsePowerSettings(text) {
  const sources = []; let current;
  for (const line of text.split('\n')) {
    const name = line.trim().replace(/:$/, '');
    const source = { 'AC Power': 'ac', 'Battery Power': 'battery', 'UPS Power': 'ups' }[name];
    if (source) { current = { source, label: { ac: 'Power adapter', battery: 'Battery', ups: 'UPS' }[source] }; sources.push(current); continue; }
    const match = line.match(/^\s*(displaysleep|sleep)\s+(\d+)\s*$/);
    if (current && match) current[match[1] === 'sleep' ? 'sleepMinutes' : 'displayMinutes'] = Number(match[2]);
  }
  return sources.filter(s => Number.isInteger(s.displayMinutes) && Number.isInteger(s.sleepMinutes));
}
const minutes = v => Number.isInteger(v) && v >= 0 && v <= 1440;
export function validateScreenRequest(value) {
  if (!value || typeof value !== 'object') return false;
  if (['status','off','wake','saver'].includes(value.op)) return true;
  if (value.op === 'settings') return ['timing','saver'].includes(value.pane);
  if (value.op === 'awake') return ['normal','system','screens'].includes(value.mode);
  if (value.op === 'save') return ['ac','battery','ups'].includes(value.source) && minutes(value.displayMinutes) && minutes(value.sleepMinutes) &&
    (value.saverSeconds === undefined || value.saverSeconds === null || Number.isInteger(value.saverSeconds) && value.saverSeconds >= 0 && value.saverSeconds <= 86400);
  return false;
}
export function createPowerController({ execute = run, companion = companionCommand } = {}) {
  const power = args => execute('/usr/bin/sudo', ['-n', powerHelper, ...args]);
  const status = async () => {
    const [text, gui, writable] = await Promise.all([
      execute('/usr/bin/pmset', ['-g','custom']),
      companion({ op: 'screen-status' }).catch(() => ({ available: false, awake: 'normal' })),
      power(['check']).then(() => true, () => false)
    ]);
    return { ...gui, ok: true, sources: parsePowerSettings(text), powerWritable: writable };
  };
  return async value => {
    if (value.op === 'status') return status();
    if (['end','lease'].includes(value.op)) return companion({ op: `screen-${value.op}`, session: value.session });
    if (!validateScreenRequest(value)) throw new Error('Invalid display action.');
    if (value.op === 'off') { await power(['off']); return status(); }
    if (value.op === 'save') {
      const before = await status(); const source = before.sources.find(s => s.source === value.source);
      if (!source) throw new Error('That power source is not available on your Mac.');
      if (!before.powerWritable) throw new Error('Update the AppleSeed Mac service to enable power timing changes.');
      if (value.saverSeconds !== undefined && (!before.available || before.saverManaged)) throw new Error('The Mac screen saver timer is unavailable or managed.');
      await power(['save', value.source, String(value.displayMinutes), String(value.sleepMinutes)]);
      if (value.saverSeconds !== undefined) {
        try {
          const result = await companion({ op: 'screen-save', session: value.session, saverSeconds: value.saverSeconds });
          if (!result.ok) throw new Error(result.error || 'The screen saver timer could not be saved.');
        } catch (error) {
          let rollbackError = false;
          try { await power(['save', value.source, String(source.displayMinutes), String(source.sleepMinutes)]); } catch { rollbackError = true; }
          throw new Error(error.message + (rollbackError ? ' Power timers may have changed; refresh to check.' : ' Power timers were restored.'));
        }
      }
      const result = await status(); const saved = result.sources.find(s => s.source === value.source);
      if (!saved || saved.displayMinutes !== value.displayMinutes || saved.sleepMinutes !== value.sleepMinutes || value.saverSeconds !== undefined && (value.saverSeconds === null ? !result.saverDefault : result.saverSeconds !== value.saverSeconds))
        throw new Error('macOS did not retain all requested timers. Refresh to check the current settings.');
      return result;
    }
    const command = { op: `screen-${value.op}`, session: value.session };
    if (value.op === 'awake') command.mode = value.mode;
    if (value.op === 'settings') command.pane = value.pane;
    const result = await companion(command);
    if (!result.ok) return result;
    return status();
  };
}
export const screenCommand = createPowerController();
