export type DashboardPanelId = "quick-start" | "stats" | "actions" | "health" | "nodes" | "games" | "servers";

export function movePanelInOrder(order: DashboardPanelId[], panelId: DashboardPanelId, direction: -1 | 1) {
  const index = order.indexOf(panelId);
  if (index === -1) return order;

  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= order.length) return order;

  const nextOrder = [...order];
  const [item] = nextOrder.splice(index, 1);
  nextOrder.splice(targetIndex, 0, item);
  return nextOrder;
}
