import RFB from './novnc/core/rfb.js';
import { decodeDesktopLayout } from './desktop-model.js';
import { encodings } from './novnc/core/encodings.js';
import { supportsWebCodecsH264Decode } from './novnc/core/util/browser.js';

// Keep noVNC's pinned 1.7.0 protocol engine; expose absolute pointer input and full display layouts.
export default class AppleRFB extends RFB {
  get disconnectReason() { return this._appleDisconnectReason || ''; }
  _socketClose(event) {
    const reasons = {
      'Session expired': 'Your session timer ended.',
      'Connection too slow': 'The screen stream could not keep up with this connection. Reconnect to try again.',
      'Screen Sharing timed out': 'Mac Screen Sharing did not respond. Reconnect to try again.',
      'Screen Sharing unavailable': 'Mac Screen Sharing became unavailable.',
      'Screen stream interrupted': 'The screen stream was interrupted. Reconnect to your Mac.',
    };
    this._appleDisconnectReason = reasons[event.reason] || (event.code === 1006 ? 'The connection to your Mac was interrupted. Check Tailscale and reconnect.' : '');
    super._socketClose(event);
  }
  setStreamProfile(profile) {
    this._appleStreamProfile = profile.encoding; this._qualityLevel = profile.quality; this._compressionLevel = profile.compression;
    if (this._rfbConnectionState === 'connected') this._sendEncodings();
  }
  _sendEncodings() {
    if (!this._appleStreamProfile) { super._sendEncodings(); return; }
    const list = [encodings.encodingCopyRect];
    if (this._fbDepth === 24) {
      if (this._appleStreamProfile !== 'quality' && supportsWebCodecsH264Decode) list.push(encodings.encodingH264);
      const order = this._appleStreamProfile === 'speed' ? ['JPEG', 'Tight', 'ZRLE', 'TightPNG'] : this._appleStreamProfile === 'quality' ? ['ZRLE', 'TightPNG', 'Tight', 'JPEG'] : ['Tight', 'TightPNG', 'ZRLE', 'JPEG'];
      list.push(...order.map(name => encodings['encoding' + name]), encodings.encodingHextile, encodings.encodingRRE, encodings.encodingZlib);
    }
    list.push(encodings.encodingRaw, encodings.pseudoEncodingQualityLevel0 + this._qualityLevel, encodings.pseudoEncodingCompressLevel0 + this._compressionLevel);
    for (const name of ['DesktopSize', 'LastRect', 'QEMUExtendedKeyEvent', 'QEMULedEvent', 'ExtendedDesktopSize', 'Xvp', 'Fence', 'ContinuousUpdates', 'DesktopName', 'ExtendedClipboard', 'ExtendedMouseButtons']) list.push(encodings['pseudoEncoding' + name]);
    if (this._fbDepth === 24) list.push(encodings.pseudoEncodingVMwareCursor, encodings.pseudoEncodingCursor);
    RFB.messages.clientEncodings(this._sock, list);
  }
  _framebufferUpdate() {
    if (this._appleFrameStart === undefined) this._appleFrameStart = performance.now();
    const complete = super._framebufferUpdate();
    if (complete) {
      const frameMs = performance.now() - this._appleFrameStart; this._appleFrameStart = undefined;
      if (!document.hidden) this.dispatchEvent(new CustomEvent('streamsample', { detail: { frameMs, queuedBytes: Math.max(0, this._sock._rQlen - this._sock._rQi) } }));
    }
    return complete;
  }
  get framebuffer() { return { width: this._fbWidth, height: this._fbHeight, screens: this._appleScreens || [] }; }
  get canvas() { return this._canvas; }
  prepareViewport() {
    this._appleOwnCursor = true; this._cursor.detach(); this.showDotCursor = false;
    this.scaleViewport = false; this.clipViewport = false; this.focusOnClick = false;
    this._canvas.style.position = 'absolute'; this._canvas.style.left = '0'; this._canvas.style.top = '0';
    this._canvas.style.margin = '0'; this._canvas.style.transformOrigin = '0 0'; this._canvas.style.cursor = 'none';
    this._screen.style.overflow = 'hidden';
  }
  _refreshCursor() {
    // Cursor.change() requires its attached target. Once AppleSeed owns drawing,
    // suppress protocol cursor refreshes as well as the fallback cursor canvas.
    if (this._appleOwnCursor) { this._canvas.style.cursor = 'none'; return; }
    super._refreshCursor();
  }
  sendPointer(x, y, mask = 0) {
    if (this._rfbConnectionState !== 'connected' || this.viewOnly || !this._fbWidth || !this._fbHeight) return;
    RFB.messages.pointerEvent(this._sock, Math.max(0, Math.min(this._fbWidth - 1, Math.round(x))), Math.max(0, Math.min(this._fbHeight - 1, Math.round(y))), mask & 127);
  }
  _resize(width, height) {
    super._resize(width, height);
    this.dispatchEvent(new CustomEvent('framebufferresize', { detail: this.framebuffer }));
  }
  _handleExtendedDesktopSize() {
    if (this._sock.rQwait('AppleSeed desktop layout', 4)) return false;
    const bytes = 4 + this._sock.rQpeek8() * 16;
    if (this._sock.rQwait('AppleSeed desktop layout', bytes)) return false;
    const accepted = this._FBU.x !== 1 || this._FBU.y === 0;
    if (accepted) this._appleScreens = decodeDesktopLayout(this._sock.rQpeekBytes(bytes), this._FBU.width, this._FBU.height);
    return super._handleExtendedDesktopSize();
  }
}
