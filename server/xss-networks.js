const NETWORK_BLUEPRINTS = [
  {
    networkId: 'network-a', code: 'A', displayName: 'Simple Web Environment',
    diagramAssetId: 'network_a', diagramPath: '/assets/networks/network-a.svg',
    subnets: [
      { id: 'client-net', displayName: 'Client Net', cidr: '192.168.10.0/24', kind: 'CLIENT' },
      { id: 'dmz', displayName: 'DMZ', cidr: '192.168.20.0/24', kind: 'DMZ' },
      { id: 'server-net', displayName: 'Server Net', cidr: '192.168.30.0/24', kind: 'SERVER' },
    ],
    nodes: [
      { id: 'client01', displayName: 'Client01', role: 'client', roles: ['workstation'], os: 'Windows', ip: '192.168.10.101', subnetId: 'client-net' },
      { id: 'reverse-proxy01', displayName: 'ReverseProxy01', role: 'reverse proxy', roles: ['reverse_proxy'], os: 'Linux', ip: '192.168.20.101', subnetId: 'dmz' },
      { id: 'web01', displayName: 'Web01', role: 'web server', roles: ['web_server'], os: 'Linux', ip: '192.168.30.101', subnetId: 'server-net' },
      { id: 'db01', displayName: 'DB01', role: 'database', roles: ['database_server'], os: 'Linux', ip: '192.168.30.102', subnetId: 'server-net' },
    ],
    connections: [['internet', 'reverse-proxy01'], ['reverse-proxy01', 'web01'], ['web01', 'db01'], ['client01', 'reverse-proxy01']],
    logSources: ['Proxy Log', 'Web Access Log', 'Application Log'],
    investigation: [
      ['web01', 'Web Access Log'], ['reverse-proxy01', 'Proxy Log'], ['web01', 'Application Log'],
    ],
  },
  {
    networkId: 'network-b', code: 'B', displayName: 'Corporate Network',
    diagramAssetId: 'network_b', diagramPath: '/assets/networks/network-b.svg',
    subnets: [
      { id: 'client-net', displayName: 'Client Net', cidr: '172.16.10.0/24', kind: 'CLIENT' },
      { id: 'dmz', displayName: 'DMZ', cidr: '172.16.20.0/24', kind: 'DMZ' },
      { id: 'server-net', displayName: 'Server Net', cidr: '172.16.30.0/24', kind: 'SERVER' },
    ],
    nodes: [
      { id: 'employee-pc01', displayName: 'EmployeePC01', role: 'client', roles: ['workstation'], os: 'Windows', ip: '172.16.10.101', subnetId: 'client-net' },
      { id: 'employee-pc02', displayName: 'EmployeePC02', role: 'client', roles: ['workstation'], os: 'Windows', ip: '172.16.10.102', subnetId: 'client-net' },
      { id: 'proxy01', displayName: 'Proxy01', role: 'proxy', roles: ['reverse_proxy'], os: 'Linux', ip: '172.16.20.101', subnetId: 'dmz' },
      { id: 'web01', displayName: 'Web01', role: 'web server', roles: ['web_server'], os: 'Linux', ip: '172.16.20.102', subnetId: 'dmz' },
      { id: 'ad01', displayName: 'AD01', role: 'directory server', roles: ['directory_server'], os: 'Windows Server', ip: '172.16.30.101', subnetId: 'server-net' },
      { id: 'file01', displayName: 'File01', role: 'file server', roles: ['file_server'], os: 'Windows Server', ip: '172.16.30.102', subnetId: 'server-net' },
    ],
    connections: [['internet', 'proxy01'], ['proxy01', 'web01'], ['employee-pc01', 'proxy01'], ['employee-pc02', 'proxy01'], ['web01', 'ad01'], ['web01', 'file01']],
    logSources: ['Proxy Log', 'Web Access Log', 'Client Browser Log', 'Authentication Log'],
    investigation: [
      ['web01', 'Web Access Log'], ['proxy01', 'Proxy Log'], ['employee-pc01', 'Client Browser Log'],
    ],
  },
  {
    networkId: 'network-c', code: 'C', displayName: 'Multi-tier Web Environment',
    diagramAssetId: 'network_c', diagramPath: '/assets/networks/network-c.svg',
    subnets: [
      { id: 'client-net', displayName: 'Client Net', cidr: '10.10.10.0/24', kind: 'CLIENT' },
      { id: 'dmz', displayName: 'DMZ', cidr: '10.10.20.0/24', kind: 'DMZ' },
      { id: 'application-net', displayName: 'Application Net', cidr: '10.10.30.0/24', kind: 'APPLICATION' },
      { id: 'db-net', displayName: 'DB Net', cidr: '10.10.40.0/24', kind: 'SERVER' },
    ],
    nodes: [
      { id: 'admin-pc01', displayName: 'AdminPC01', role: 'admin client', roles: ['workstation'], os: 'Windows', ip: '10.10.10.101', subnetId: 'client-net' },
      { id: 'waf01', displayName: 'WAF01', role: 'WAF', roles: ['reverse_proxy'], os: 'Linux', ip: '10.10.20.101', subnetId: 'dmz' },
      { id: 'frontend01', displayName: 'Frontend01', role: 'web server', roles: ['web_server'], os: 'Linux', ip: '10.10.20.102', subnetId: 'dmz' },
      { id: 'app01', displayName: 'App01', role: 'application server', roles: ['application_server'], os: 'Linux', ip: '10.10.30.101', subnetId: 'application-net' },
      { id: 'db01', displayName: 'DB01', role: 'database', roles: ['database_server'], os: 'Linux', ip: '10.10.40.101', subnetId: 'db-net' },
    ],
    connections: [['internet', 'waf01'], ['waf01', 'frontend01'], ['frontend01', 'app01'], ['app01', 'db01'], ['admin-pc01', 'frontend01'], ['admin-pc01', 'app01']],
    logSources: ['WAF Log', 'Frontend Access Log', 'Application Log', 'Browser Log'],
    investigation: [
      ['frontend01', 'Frontend Access Log'], ['waf01', 'WAF Log'], ['admin-pc01', 'Browser Log'],
    ],
  },
  {
    networkId: 'network-d', code: 'D', displayName: 'Segmented Enterprise Environment',
    diagramAssetId: 'network_d', diagramPath: '/assets/networks/network-d.svg',
    subnets: [
      { id: 'client-net', displayName: 'Client Net', cidr: '192.168.100.0/24', kind: 'CLIENT' },
      { id: 'dmz', displayName: 'DMZ', cidr: '192.168.110.0/24', kind: 'DMZ' },
      { id: 'application-net', displayName: 'Application Net', cidr: '192.168.120.0/24', kind: 'APPLICATION' },
      { id: 'management-net', displayName: 'Management Net', cidr: '192.168.130.0/24', kind: 'MANAGEMENT' },
    ],
    nodes: [
      { id: 'client01', displayName: 'Client01', role: 'client', roles: ['workstation'], os: 'Windows', ip: '192.168.100.101', subnetId: 'client-net' },
      { id: 'proxy01', displayName: 'Proxy01', role: 'proxy', roles: ['reverse_proxy'], os: 'Linux', ip: '192.168.110.101', subnetId: 'dmz' },
      { id: 'dmz-web01', displayName: 'DMZWeb01', role: 'web server', roles: ['web_server'], os: 'Linux', ip: '192.168.110.102', subnetId: 'dmz' },
      { id: 'internal-app01', displayName: 'InternalApp01', role: 'application server', roles: ['application_server'], os: 'Linux', ip: '192.168.120.101', subnetId: 'application-net' },
      { id: 'db01', displayName: 'DB01', role: 'database', roles: ['database_server'], os: 'Linux', ip: '192.168.120.102', subnetId: 'application-net' },
      { id: 'log01', displayName: 'Log01', role: 'central log', roles: ['log_server'], os: 'Linux', ip: '192.168.130.101', subnetId: 'management-net' },
      { id: 'admin-pc01', displayName: 'AdminPC01', role: 'admin client', roles: ['workstation'], os: 'Windows', ip: '192.168.130.102', subnetId: 'management-net' },
    ],
    connections: [['internet', 'proxy01'], ['client01', 'proxy01'], ['proxy01', 'dmz-web01'], ['dmz-web01', 'internal-app01'], ['internal-app01', 'db01'], ['proxy01', 'log01'], ['dmz-web01', 'log01'], ['internal-app01', 'log01'], ['admin-pc01', 'internal-app01']],
    logSources: ['Proxy Log', 'DMZ Web Access Log', 'Application Log', 'Central Log', 'Client Browser Log'],
    investigation: [
      ['dmz-web01', 'DMZ Web Access Log'], ['proxy01', 'Proxy Log'], ['log01', 'Central Log'],
    ],
  },
];

function technicalNetwork(blueprint) {
  const client = blueprint.nodes.find(node => node.roles.includes('workstation'));
  const web = blueprint.nodes.find(node => node.roles.includes('web_server'));
  return {
    schemaVersion: '1.0',
    nodes: blueprint.nodes.map(node => ({ id: node.id, type: 'host', roles: node.roles,
      os: node.os.toLowerCase().replace(' ', '_'), trustZone: node.subnetId })),
    services: [
      { id: `${client.id}-browser`, nodeId: client.id, type: 'web_browser', platform: 'browser' },
      { id: `${web.id}-web`, nodeId: web.id, type: 'web_application', platform: 'web' },
    ],
    trustZones: blueprint.subnets.map(subnet => ({ id: subnet.id,
      label: `${subnet.displayName} ${subnet.cidr}` })),
    connections: blueprint.connections.filter(([from]) => from !== 'internet')
      .map(([from, to]) => ({ from, to })),
    reachability: [{ from: client.id, toService: `${web.id}-web`, value: true }],
  };
}

function scenarioContext(blueprint) {
  const client = blueprint.nodes.find(node => node.roles.includes('workstation'));
  const web = blueprint.nodes.find(node => node.roles.includes('web_server'));
  const browser = `${client.id}-browser`;
  const webService = `${web.id}-web`;
  return {
    schemaVersion: '1.0',
    entities: [{ id: 'xss-actor', type: 'actor' }, { id: 'xss-victim', type: 'user' },
      { id: 'xss-request', type: 'web_request' }],
    vulnerabilities: [{ predicate: 'input_reflected_as_executable_script',
      args: [webService, 'xss-request'], value: true }],
    attackerInitialPrivileges: [{ predicate: 'controls_request_input',
      args: ['xss-actor', 'xss-request'], value: true }],
    requiredUserActions: [],
    loggingConfiguration: [
      { predicate: 'access_record_available', args: [webService, 'xss-request'], value: true },
      { predicate: 'script_execution_record_available',
        args: [browser, webService, 'xss-request'], value: true },
    ],
    authenticationConditions: [{ predicate: 'request_access_permitted',
      args: ['xss-victim', webService, 'xss-request'], value: true }],
    otherConditions: [
      { predicate: 'request_targets_service', args: ['xss-request', webService], value: true },
      { predicate: 'user_uses_browser', args: ['xss-victim', browser], value: true },
      { predicate: 'browser_request_issued',
        args: ['xss-victim', browser, webService, 'xss-request'], value: true },
      { predicate: 'script_execution_permitted',
        args: [browser, webService, 'xss-request'], value: true },
    ],
  };
}

export const XSS_NETWORKS = Object.freeze(NETWORK_BLUEPRINTS.map(item => Object.freeze(item)));

export function publicXssNetworks() {
  return XSS_NETWORKS.map(({ networkId, code, displayName, diagramAssetId, diagramPath,
    subnets, nodes, connections, logSources }) => structuredClone({ networkId, code,
    displayName, diagramAssetId, diagramPath, subnets, nodes, connections, logSources }));
}

export function xssTechnicalSelection(networkId, difficulty) {
  const blueprint = XSS_NETWORKS.find(item => item.networkId === networkId);
  if (!blueprint || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) return null;
  return { attackType: 'reflected_xss', selectedNetworkId: networkId,
    selectedNetworkDefinition: structuredClone(blueprint), difficulty,
    requiredEvidenceCount: difficulty,
    technicalConstraints: {
      simulationOnly: true, externalCommandsAllowed: false, realNetworkAllowed: false,
      xssScope: 'REFLECTED_XSS_BROWSER_ORIGIN_ONLY',
    },
    network: technicalNetwork(blueprint), scenarioContext: scenarioContext(blueprint),
  };
}
