const COMPANY_KEY = 'd2-project-management.company.v1';

export function allowedView(preferred, permissions, superAdmin = false) {
    const allowed = {
        projects: permissions.tab_proj === true,
        reports: permissions.tab_rep === true,
        new: permissions.tab_new === true,
        contractors: superAdmin || permissions.contractors === true,
        users: superAdmin,
        logs: superAdmin
    };
    return allowed[preferred] ? preferred : Object.keys(allowed).find(view => allowed[view]) || '';
}

export function preferredCompany(search = '', stored = '') {
    const value = new URLSearchParams(search).get('company');
    if (value === 'smart') return 'Smart Home';
    if (value === 'hvac') return 'HVAC';
    return ['Smart Home', 'HVAC', 'Ambas'].includes(stored) ? stored : 'Ambas';
}

export function allowedCompany(preferred, permissions) {
    const smart = permissions.smart === true;
    const hvac = permissions.hvac === true;
    if (preferred === 'Smart Home' && smart) return preferred;
    if (preferred === 'HVAC' && hvac) return preferred;
    if (preferred === 'Ambas' && smart && hvac) return preferred;
    return smart ? 'Smart Home' : hvac ? 'HVAC' : '';
}

export function companyQueryValue(company) {
    return company === 'Smart Home' ? 'smart' : company === 'HVAC' ? 'hvac' : '';
}

export { COMPANY_KEY };
