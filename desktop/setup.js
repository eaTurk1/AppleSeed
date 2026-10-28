const input=document.getElementById('address'),message=document.getElementById('message');
window.AppleSeedSetup.get().then(state=>{input.value=state?.endpoint||'';});
document.getElementById('setup').addEventListener('submit',async event=>{event.preventDefault();if(!await window.AppleSeedSetup.save(input.value))message.textContent='Use the HTTPS .ts.net address on port 9447 copied from your Mac.';});

const hostState=document.getElementById('host-state');
document.getElementById('host-start').addEventListener('click',async()=>{hostState.textContent='Starting private host…';const result=await window.AppleSeedSetup.host({vncPort:Number(document.getElementById('vnc-port').value),portalURL:document.getElementById('host-portal').value});hostState.textContent=result.error||('Sharing privately. Enter this address on your other device: '+result.endpoint);});
document.getElementById('host-stop').addEventListener('click',async()=>{await window.AppleSeedSetup.host({op:'stop'});hostState.textContent='Sharing stopped.';});
