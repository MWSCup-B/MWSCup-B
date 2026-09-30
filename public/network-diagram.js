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

// Put nodes into left-to-right access layers. Cycles stay in the last layer reached
// instead of making the diagram grow indefinitely.
function accessRanks(nodes, connections) {
  const nodeIds = new Set(nodes.map(node => node.nodeId));
  const incoming = new Map(nodes.map(node => [node.nodeId, 0]));
  const outgoing = new Map(nodes.map(node => [node.nodeId, []]));
  for (const connection of connections) {
    if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) continue;
    incoming.set(connection.toNodeId, incoming.get(connection.toNodeId) + 1);
    outgoing.get(connection.fromNodeId).push(connection.toNodeId);
  }
  const ranks = new Map(nodes.map(node => [node.nodeId, 0]));
  const queue = nodes.filter(node => incoming.get(node.nodeId) === 0).map(node => node.nodeId);
  const visited = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const from = queue[cursor]; visited.add(from);
    for (const to of outgoing.get(from)) {
      ranks.set(to, Math.max(ranks.get(to), ranks.get(from) + 1));
      incoming.set(to, incoming.get(to) - 1);
      if (incoming.get(to) === 0) queue.push(to);
    }
  }
  // Keep cyclic components usable: place them after any already-ranked predecessor.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const connection of connections) {
      if (visited.has(connection.toNodeId) || !ranks.has(connection.fromNodeId)
        || !ranks.has(connection.toNodeId)) continue;
      const next = Math.min(nodes.length - 1, ranks.get(connection.fromNodeId) + 1);
      if (next > ranks.get(connection.toNodeId)) { ranks.set(connection.toNodeId, next); changed = true; }
    }
    if (!changed) break;
  }
  return ranks;
}

export function layoutNetwork(network) {
  const boxWidth = 258, columnGap = 92, rowGap = 24, margin = 28;
  const ranks = accessRanks(network.nodes, network.connections);
  const maxRank = Math.max(0, ...ranks.values());
  const width = margin * 2 + (maxRank + 1) * boxWidth + maxRank * columnGap;
  let y = 12;
  const positions = new Map();
  const groups = network.subnets.map((subnet, rowIndex) => {
    const nodes = network.nodes.filter(node => node.subnetId === subnet.subnetId);
    const heading = wrapDiagramText(`${subnet.label} / ${subnet.cidr} / ${subnet.trustBoundaryId}`, 90);
    const contentTop = y + 20 + heading.length * 18 + 18;
    const columns = new Map();
    for (const node of nodes) {
      const rank = ranks.get(node.nodeId) ?? 0;
      const services = network.services.filter(service => service.nodeId === node.nodeId);
      const lines = [node.label, `IP: ${node.ip}`, `Type: ${node.nodeType}`, `OS: ${node.os}`,
        `Role: ${node.roles.join(', ')}`, ...services.map(service => `${service.label} [${service.serviceType}]`)]
        .flatMap(value => wrapDiagramText(value));
      const card = { node, rowIndex, rank, x: margin + rank * (boxWidth + columnGap),
        y: 0, width: boxWidth, height: lines.length * 18 + 38, lines };
      const column = columns.get(rank) ?? []; column.push(card); columns.set(rank, column);
    }
    let contentHeight = 108;
    for (const cards of columns.values()) {
      let cardY = contentTop;
      for (const card of cards) {
        card.y = cardY; positions.set(card.node.nodeId, card);
        cardY += card.height + rowGap;
      }
      contentHeight = Math.max(contentHeight, cardY - contentTop - rowGap);
    }
    const cards = [...columns.values()].flat();
    const group = { subnet, heading, y, bottom: contentTop + contentHeight + 24, cards };
    y = group.bottom + 28;
    return group;
  });
  const edges = network.connections.flatMap(connection => {
    const from = positions.get(connection.fromNodeId), to = positions.get(connection.toNodeId);
    if (!from || !to) return [];
    let path;
    if (from.x < to.x) {
      const x1 = from.x + from.width, y1 = from.y + from.height / 2;
      const x2 = to.x, y2 = to.y + to.height / 2;
      const bend = Math.max(34, Math.min(90, (x2 - x1) / 2));
      path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    } else {
      // Same-column and cycle edges use the free gutter beside the cards.
      const goRight = from.x + from.width + 24 <= width - 8;
      const x1 = goRight ? from.x + from.width : from.x;
      const x2 = goRight ? to.x + to.width : to.x;
      const side = goRight ? Math.max(x1, x2) + 24 : Math.min(x1, x2) - 24;
      const y1 = from.y + from.height / 2, y2 = to.y + to.height / 2;
      path = `M ${x1} ${y1} H ${side} V ${y2} H ${x2}`;
    }
    return [{ ...connection, path }];
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
    '矢印は送信元ノードからアクセス可能な接続先ノードを示します。'));
  const defs = node('defs');
  const marker = node('marker', { id: 'diagram-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  marker.append(node('polygon', { points: '0,0 10,5 0,10', class: 'diagram-arrowhead' }));
  defs.append(marker); svg.append(defs);
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
    const path = node('path', { d: edge.path, class: 'diagram-connection', 'marker-end': 'url(#diagram-arrow)',
      'data-from': edge.fromNodeId, 'data-to': edge.toNodeId });
    path.append(node('title', {}, `${edge.fromNodeId} → ${edge.toNodeId}`)); edges.append(path);
  }
}
