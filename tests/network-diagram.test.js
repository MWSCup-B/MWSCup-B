import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutNetwork, renderNetworkDiagram } from '../public/network-diagram.js';
import { Element } from './helpers/author-dom.js';

test('network preview draws each configured link above backgrounds and wraps long node fields', () => {
  const network = {
    subnets: [{ subnetId: 'a', label: '外部', cidr: '192.0.2.0/24', trustBoundaryId: 'external' },
      { subnetId: 'b', label: '業務', cidr: '10.0.0.0/24', trustBoundaryId: 'internal' }],
    nodes: ['sender', 'web', 'database'].map((nodeId, index) => ({ nodeId, subnetId: index ? 'b' : 'a',
      label: '長いサーバー名'.repeat(10), nodeType: 'SERVER', ip: `10.0.0.${index + 1}`,
      os: 'linux', roles: ['role_with_a_long_unbroken_name'.repeat(3)] })),
    services: [{ nodeId: 'web', label: 'Webアプリケーション'.repeat(7), serviceType: 'web' }],
    connections: [{ fromNodeId: 'sender', toNodeId: 'web' }, { fromNodeId: 'web', toNodeId: 'database' }],
  };
  const before = structuredClone(network), layout = layoutNetwork(network);
  assert.equal(layout.edges.length, 2);
  const cards = new Map(layout.groups.flatMap(group => group.cards.map(card => [card.node.nodeId, card])));
  assert.ok(cards.get('sender').x < cards.get('web').x);
  assert.ok(cards.get('web').x < cards.get('database').x);
  assert.ok(layout.width < 1200); // Link count must not add empty routing space to the right.
  assert.ok(layout.edges.every(edge => edge.path.includes(' C ')));
  for (const group of layout.groups) for (const card of group.cards) {
    const lastBaseline = card.y + 23 + (card.lines.length - 1) * 18;
    assert.ok(lastBaseline < card.y + card.height - 10);
    assert.ok(card.lines.every(line => [...line].reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? 2 : 1), 0) <= 34));
    assert.ok(card.lines.join('').includes(card.node.label));
  }
  const svg = new Element('svg');
  renderNetworkDiagram(svg, network, { createElementNS: (_, tag) => new Element(tag) });
  assert.deepEqual(svg.children.filter(child => child.tagName === 'G').map(child => child.dataset.layer), ['subnets', 'connections', 'nodes']);
  assert.equal(svg.querySelectorAll('path').length, network.connections.length);
  assert.ok(svg.querySelectorAll('.diagram-connection')
    .every(path => path.getAttribute('marker-end') === 'url(#diagram-arrow)'));
  for (const text of svg.querySelector('[data-layer="nodes"]').querySelectorAll('text')) {
    assert.ok(Number(text.getAttribute('textLength')) <= 234);
  }
  renderNetworkDiagram(svg, network, { createElementNS: (_, tag) => new Element(tag) });
  assert.equal(svg.querySelectorAll('path').length, 2); // Re-render never duplicates links.
  assert.deepEqual(network, before);
});
