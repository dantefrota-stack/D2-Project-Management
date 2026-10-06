const emailKey = value => String(value || '').trim().toLowerCase();
const companyKey = value => {
    const key = String(value || '').trim().toLowerCase();
    return key === 'hvac' ? 'HVAC' : ['smart','smart home'].includes(key) ? 'Smart Home' : '';
};

export function activityDate(log) {
    for (const value of [log.timestampIso, log.timestamp, log.createdAt, log._renderDate]) {
        if (!value) continue;
        const date = value.toDate ? value.toDate() : typeof value.seconds === 'number' ? new Date(value.seconds * 1000) : new Date(value);
        if (Number.isFinite(date.getTime())) return date;
    }
    return new Date(0);
}

// The caller supplies only audit records already authorized for its session.
// Match the actor's email, never a name or a person mentioned in the action.
export function recentMemberActivity(logs, member, company, projects = []) {
    const email = emailKey(member?.email);
    if (!email) return [];
    const selectedCompany = companyKey(company);
    const projectCompanies = new Map(projects.map(project => [String(project.id), companyKey(project.empresa)]));
    return logs.filter(log => {
        if (emailKey(log.user) !== email) return false;
        const recordCompany = companyKey(log.company || log.empresa) || projectCompanies.get(String(log.projectId || ''));
        return !selectedCompany || !recordCompany || selectedCompany === recordCompany;
    }).sort((a, b) => activityDate(b) - activityDate(a)).slice(0, 5);
}
