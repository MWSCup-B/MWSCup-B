const svgNs = 'http://www.w3.org/2000/svg';
const units = value => [...value].reduce((sum, letter) => sum + (/[^\x00-\x7f]/.test(letter) ? 2 : 1), 0);
export function wrapDiagramText(value, limit = 34) {
  const lines = []; let line = '';
  for (const letter of String(value)) {
    if (letter === '\n' || units(line + letter) > limit) { lines.push(line); line = ''; }
    if (letter !== '\n') line += letter;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function layoutNetwork(network) {
  const boxWidth = 258, gap = 38, margin = 28;
  const rows = network.subnets.map(subnet => ({ subnet, nodes: network.nodes.filter(node => node.subnetId === subnet.subnetId) }));
  const contentWidth = Math.max(620, ...rows.map(row => row.nodes.length * (boxWidth + gap) + margin * 2));
  const width = contentWidth + network.connections.length * 12 + 30;
  let y = 12;
  const positions = new Map();
  const groups = rows.map(({ subnet, nodes }, rowIndex) => {
    const heading = wrapDiagramText(`${subnet.label} / ${subnet.cidr} / ${subnet.trustBoundaryId}`, 90);
    const laneTop = y + 20 + heading.length * 18;
    const top = laneTop + (network.connections.length + 1) * 12 + 14;
    const cards = nodes.map((node, index) => {
      const services = network.services.filter(service => service.nodeId === node.nodeId);
      const lines = [node.label, `IP: ${node.ip}`, `Type: ${node.nodeType}`, `OS: ${node.os}`,
        `Role: ${node.roles.join(', ')}`, ...services.map(service => `${service.label} [${service.serviceType}]`)]
        .flatMap(value => wrapDiagramText(value));
      return { node, rowIndex, x: margin + index * (boxWidth + gap), y: top, width: boxWidth, lines };
    });
    const height = Math.max(108, ...cards.map(card => card.lines.length * 18 + 28));
    for (const card of cards) { card.height = height; positions.set(card.node.nodeId, card); }
    const group = { subnet, heading, y, laneTop, bottom: top + height + 24, cards };
    y = group.bottom + 28; return group;
  });
  const edges = network.connections.flatMap((connection, index) => {
    const from = positions.get(connection.fromNodeId), to = positions.get(connection.toNodeId);
    if (!from || !to) return [];
    const x1 = from.x + from.width / 2, x2 = to.x + to.width / 2;
    const lane1 = groups[from.rowIndex].laneTop + index * 12;
    const lane2 = groups[to.rowIndex].laneTop + index * 12;
    const side = contentWidth + index * 12;
    return [{ ...connection, path: from.rowIndex === to.rowIndex
      ? `M ${x1} ${from.y} V ${lane1} H ${x2} V ${to.y}`
      : `M ${x1} ${from.y} V ${lane1} H ${side} V ${lane2} H ${x2} V ${to.y}` }];
  });
  return { width, height: y, groups, edges };
}

export function renderNetworkDiagram(svg, network, document) {
  const layout = layoutNetwork(network); svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svg.setAttribute('width', layout.width); svg.setAttribute('height', layout.height);
  const node = (tag, attributes = {}, text) => {
    const element = document.createElementNS(svgNs, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  };
  svg.append(node('title', {}, 'ネットワーク構成図'), node('desc', {},
    '線は設定されたノード間の接続を示します。通信の許可・禁止は到達制御の設定に従います。'));
  const backgrounds = node('g', { 'data-layer': 'subnets' });
  const edges = node('g', { 'data-layer': 'connections' });
  const cards = node('g', { 'data-layer': 'nodes' });
  // Edges must be above subnet backgrounds and below node cards.
  svg.append(backgrounds, edges, cards);
  for (const group of layout.groups) {
    backgrounds.append(node('rect', { x: 8, y: group.y, width: layout.width - 16,
      height: group.bottom - group.y, rx: 10, class: 'diagram-subnet' }));
    group.heading.forEach((line, index) => backgrounds.append(node('text',
      { x: 22, y: group.y + 22 + index * 18, class: 'diagram-subnet-title' }, line)));
    for (const card of group.cards) {
      const box = node('g', { 'data-node-id': card.node.nodeId });
      box.append(node('title', {}, card.lines.join('\n')), node('rect', { x: card.x, y: card.y,
        width: card.width, height: card.height, rx: 8, class: 'diagram-node' }));
      card.lines.forEach((line, index) => box.append(node('text', { x: card.x + 12, y: card.y + 23 + index * 18,
        class: index === 0 ? 'diagram-node-title' : 'diagram-caption',
        textLength: Math.min(card.width - 24, units(line) * 6.8), lengthAdjust: 'spacingAndGlyphs' }, line)));
      cards.append(box);
    }
  }
  for (const edge of layout.edges) {
    const path = node('path', { d: edge.path, class: 'diagram-connection',
      'data-from': edge.fromNodeId, 'data-to': edge.toNodeId });
    path.append(node('title', {}, `${edge.fromNodeId} — ${edge.toNodeId}`)); edges.append(path);
  }
}
