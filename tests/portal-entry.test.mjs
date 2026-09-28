import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredCompany, allowedCompany, allowedView, companyQueryValue } from '../portal-entry.mjs';

test('token renewal preserves a permitted report or editing view', () => {
    const manager = {tab_proj:true,tab_rep:true,tab_new:true};
    assert.equal(allowedView('reports', manager), 'reports');
    assert.equal(allowedView('new', manager), 'new');
    assert.equal(allowedView('', manager), 'projects');
});

test('renewal moves away from revoked reports, edit and administrative views', () => {
    const reader = {tab_proj:true};
    for (const view of ['reports','new','users','logs','contractors']) assert.equal(allowedView(view, reader), 'projects');
    assert.equal(allowedView('users', reader, true), 'users');
    assert.equal(allowedView('reports', {}), '');
});

test('the Portal link opens the original project app in the selected company', () => {
    assert.equal(preferredCompany('?company=smart', 'HVAC'), 'Smart Home');
    assert.equal(preferredCompany('?company=hvac', 'Smart Home'), 'HVAC');
    assert.equal(companyQueryValue('Smart Home'), 'smart');
    assert.equal(companyQueryValue('HVAC'), 'hvac');
});

test('the project app falls back to an authorized company', () => {
    assert.equal(allowedCompany('HVAC', { smart: true, hvac: false }), 'Smart Home');
    assert.equal(allowedCompany('Ambas', { smart: false, hvac: true }), 'HVAC');
    assert.equal(allowedCompany('Ambas', { smart: true, hvac: true }), 'Ambas');
    assert.equal(allowedCompany('Smart Home', { smart: false, hvac: false }), '');
});

test('only known company values are accepted from a link or saved preference', () => {
    assert.equal(preferredCompany('?company=other', 'HVAC'), 'HVAC');
    assert.equal(preferredCompany('?company=other', 'other'), 'Ambas');
});
