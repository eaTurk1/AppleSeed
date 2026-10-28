const form = document.getElementById('pair'), button = document.getElementById('enter'), code = document.getElementById('code'), message = document.getElementById('message');
form.addEventListener('submit', async event => {
  event.preventDefault(); if (button.disabled) return; button.disabled = true;
  try {
    const response = await fetch('./pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.value }) });
    code.value = ''; const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Session unavailable.');
    location.replace('./');
  } catch (error) { message.textContent = error.message || 'Unable to connect.'; button.disabled = false; }
});
