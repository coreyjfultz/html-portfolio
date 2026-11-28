// Custom roles (Settings → Roles): an owner builds a role from permission switches and a
// customer-access level. Built-in roles can't be changed. See applyRoles() in schema.js.
import { G, PERMISSIONS, CUSTOMER_ACCESS, BUILTIN_ROLES, ROLE_INFO, applyRoles, customRoles, customerAccess } from '../public/js/schema.js';
import { HttpError } from './resources.js';
import { audit } from './security.js';

export function loadRoles(db) {
  const rows = db.prepare('SELECT * FROM custom_roles ORDER BY name').all()
    .map(r => ({ key: r.key, name: r.name, description: r.description, customer_access: r.customer_access, permissions: JSON.parse(r.permissions || '[]') }));
  applyRoles(rows);
  return rows;
}

const describe = () => [
  ...BUILTIN_ROLES.map(k => ({ key: k, name: ROLE_INFO[k].label, description: ROLE_INFO[k].desc, builtin: true, customer_access: customerAccess(k),
    permissions: PERMISSIONS.map(p => p.key).filter(p => G[p].includes(k)) })),
  ...customRoles().map(r => ({ ...r, builtin: false, customer_access: customerAccess(r.key) })),
];

function clean(body) {
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'Name the role');
  const permissions = [...new Set((Array.isArray(body.permissions) ? body.permissions : []).filter(p => PERMISSIONS.some(x => x.key === p)))];
  const access = CUSTOMER_ACCESS[body.customer_access] ? body.customer_access : 'none';
  return { name, description: String(body.description || '').trim().slice(0, 200) || null, permissions, customer_access: access };
}

export function registerRoleRoutes(r) {
  // Everyone's browser needs the role list to know what each permission group contains.
  r('GET', '/api/roles', G.all, ({ db }) => {
    const counts = Object.fromEntries(db.prepare('SELECT role, COUNT(*) AS n FROM users WHERE active = 1 GROUP BY role').all().map(x => [x.role, x.n]));
    return { roles: describe().map(x => ({ ...x, users: counts[x.key] || 0 })), permissions: PERMISSIONS, customer_access: CUSTOMER_ACCESS };
  });
  r('POST', '/api/roles', G.owner, ({ db, user, body }) => {
    const d = clean(body);
    if (Object.values(ROLE_INFO).some(x => x.label.toLowerCase() === d.name.toLowerCase())) throw new HttpError(409, 'There’s already a role with that name');
    let key = `c_${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'role'}`;
    for (let i = 2; db.prepare('SELECT 1 FROM custom_roles WHERE key = ?').get(key); i++) key = `${key.replace(/_\d+$/, '')}_${i}`;
    db.prepare('INSERT INTO custom_roles (key, name, description, permissions, customer_access) VALUES (?,?,?,?,?)').run(key, d.name, d.description, JSON.stringify(d.permissions), d.customer_access);
    loadRoles(db);
    audit(db, user, 'create role', 'roles', null, `${d.name}: ${d.permissions.join(', ') || 'no extra permissions'}; customers: ${d.customer_access}`);
    return { key };
  });
  r('PUT', '/api/roles/:key', G.owner, ({ db, user, params, body }) => {
    const row = db.prepare('SELECT * FROM custom_roles WHERE key = ?').get(params.key);
    if (!row) throw new HttpError(BUILTIN_ROLES.includes(params.key) ? 400 : 404, BUILTIN_ROLES.includes(params.key) ? 'Built-in roles can’t be changed. Make a custom role instead.' : 'Role not found');
    const d = clean({ ...row, permissions: JSON.parse(row.permissions || '[]'), ...body });
    if (Object.entries(ROLE_INFO).some(([k, x]) => k !== row.key && x.label.toLowerCase() === d.name.toLowerCase())) throw new HttpError(409, 'There’s already a role with that name');
    db.prepare('UPDATE custom_roles SET name = ?, description = ?, permissions = ?, customer_access = ? WHERE key = ?').run(d.name, d.description, JSON.stringify(d.permissions), d.customer_access, row.key);
    loadRoles(db);
    audit(db, user, 'change role', 'roles', null, `${d.name}: ${d.permissions.join(', ') || 'no extra permissions'}; customers: ${d.customer_access}`);
    return { ok: true };
  });
  r('DELETE', '/api/roles/:key', G.owner, ({ db, user, params }) => {
    const row = db.prepare('SELECT * FROM custom_roles WHERE key = ?').get(params.key);
    if (!row) throw new HttpError(404, 'Role not found');
    const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?').get(row.key).n;
    if (n) throw new HttpError(409, `${n} user${n > 1 ? 's have' : ' has'} this role. Give them another role first.`);
    db.prepare('DELETE FROM custom_roles WHERE key = ?').run(row.key);
    loadRoles(db);
    audit(db, user, 'delete role', 'roles', null, row.name);
    return { ok: true };
  });
}
