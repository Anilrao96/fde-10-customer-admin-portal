const $ = selector => document.querySelector(selector);
const state = { token: '', data: null };
const featureMeta = {
  analytics: ['Analytics', 'View aggregate product insights'],
  exports: ['Data exports', 'Download tenant reports'],
  apiAccess: ['API access', 'Connect external tools and integrations']
};
function node(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function message(text) { $('#message').textContent = text; }
async function api(path, method = 'GET', value) {
  const response = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${state.token}`, ...(value ? { 'content-type': 'application/json' } : {}) },
    body: value ? JSON.stringify(value) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `Request failed (${response.status})`);
  return result;
}
async function update(path, method, value) {
  try { state.data = await api(path, method, { ...value, expectedVersion: state.data.tenant.version }); message(''); render(); }
  catch (error) { message(error.message); if (error.message.includes('refresh')) await refresh(); }
}
async function refresh() {
  try { state.data = await api('/api/bootstrap'); message(''); render(); }
  catch (error) { state.data = null; $('#workspace').hidden = true; message(error.message); }
}
function render() {
  const data = state.data;
  if (!data) return;
  const manager = data.actor.role !== 'viewer';
  $('#workspace').hidden = false;
  $('#tenant-name').textContent = data.tenant.name;
  $('#actor-label').textContent = `${data.actor.name} · ${data.actor.role}`;
  $('#avatar').textContent = data.actor.name[0];
  $('#version').textContent = `Revision ${data.tenant.version}`;
  $('#member-count').textContent = data.members.length;
  $('#feature-count').textContent = Object.values(data.features).filter(Boolean).length;
  $('#role-label').textContent = data.actor.role;
  $('#add-member').hidden = !manager;
  const members = $('#members-body'); members.replaceChildren();
  for (const member of data.members) {
    const row = document.createElement('tr');
    const who = document.createElement('td'); who.append(node('span', member.name), node('small', member.email)); row.append(who);
    const role = document.createElement('td'); role.append(node('span', member.role, `badge ${member.role}`)); row.append(role);
    const actions = document.createElement('td');
    if (manager && member.id !== data.actor.id && (data.actor.role === 'owner' || member.role !== 'owner')) {
      const roles = document.createElement('select'); roles.setAttribute('aria-label', `Role for ${member.name}`);
      for (const name of data.actor.role === 'owner' ? ['owner', 'admin', 'viewer'] : ['admin', 'viewer']) {
        const option = node('option', name); option.value = name; option.selected = member.role === name; roles.append(option);
      }
      roles.addEventListener('change', () => update(`/api/members/${member.id}`, 'PATCH', { role: roles.value }));
      const remove = node('button', 'Remove', 'button small danger'); remove.type = 'button';
      remove.addEventListener('click', () => { if (confirm(`Remove ${member.name} from ${data.tenant.name}?`)) update(`/api/members/${member.id}`, 'DELETE', {}); });
      actions.append(roles, ' ', remove);
    } else actions.textContent = '—';
    row.append(actions); members.append(row);
  }
  const features = $('#feature-list'); features.replaceChildren();
  for (const [key, [title, description]] of Object.entries(featureMeta)) {
    const row = node('div', '', 'feature-row'); const words = document.createElement('div'); words.append(node('strong', title), node('small', description));
    const label = node('label', '', 'switch'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = data.features[key]; input.disabled = !manager; input.setAttribute('aria-label', title);
    input.addEventListener('change', () => update(`/api/features/${key}`, 'PATCH', { enabled: input.checked })); label.append(input, node('span', ''));
    row.append(words, label); features.append(row);
  }
  const activity = $('#activity-list'); activity.replaceChildren();
  if (!data.recentActivity.length) activity.append(node('li', 'No changes recorded yet.', 'empty'));
  for (const event of data.recentActivity) {
    const item = document.createElement('li'); item.append(node('strong', event.action.replaceAll('.', ' ')), ` · ${event.target}`);
    const date = node('time', new Date(event.at).toLocaleString()); date.dateTime = event.at; item.append(date); activity.append(item);
  }
}
$('#account-select').addEventListener('change', event => { $('#token-input').value = event.target.value; });
$('#connect-button').addEventListener('click', () => { state.token = $('#token-input').value.trim(); refresh(); });
$('#add-member').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.target);
  await update('/api/members', 'POST', { name: form.get('name'), email: form.get('email'), role: form.get('role') });
  if (!$('#message').textContent) event.target.reset();
});
fetch('/api/demo-accounts').then(response => response.ok ? response.json() : null).then(result => {
  for (const account of result?.accounts || []) { const option = node('option', account.label); option.value = account.token; $('#account-select').append(option); }
  if (!result) $('#account-select').hidden = true;
}).catch(() => { $('#account-select').hidden = true; });
