import type { Machine } from "./service-due.js";
import { serviceDue } from "./service-due.js";

export type SentinelSeverity = "low" | "medium" | "high";

export type SentinelRiskCategory =
  "equipment_lifespan" | "maintenance_overdue" | "stock_critical" | "stock_low";

export type SentinelRisk = {
  id: string;
  category: SentinelRiskCategory;
  severity: SentinelSeverity;
  score: number;
  title: string;
  description: string;
  explanation: string[];
  recommended_action: string;
  entity: {
    type: "equipment" | "stock_item";
    id: string;
    name: string;
    mine_id?: string | null;
    plant?: string;
  };
  detected_at: string;
};

export type SentinelEquipment = Machine & {
  expected_life_tons: number | null;
  expected_life_hours: number | null;
  hours_since_install: number;
};

export type SentinelStockLevel = {
  id: string;
  stock_item_id: string;
  plant: string;
  qty_on_hand: number;
  reorder_point: number;
  reorder_qty: number;
  stock_item: {
    name: string;
    sku: string | null;
  };
};

export type SentinelInput = {
  equipment: readonly SentinelEquipment[];
  stockLevels: readonly SentinelStockLevel[];
  today: string;
  detectedAt?: string;
};

const severityFor = (score: number): SentinelSeverity => {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
};

const percentageUsed = (used: number, expected: number): number | null => {
  if (!Number.isFinite(used) || !Number.isFinite(expected) || expected <= 0) {
    return null;
  }

  return Math.max(0, (used / expected) * 100);
};

function equipmentLifespanRisks(
  equipment: readonly SentinelEquipment[],
  detectedAt: string,
): SentinelRisk[] {
  const risks: SentinelRisk[] = [];

  for (const machine of equipment) {
    if (machine.status !== "active") continue;

    const tonsUsed = percentageUsed(machine.tons_since_install, machine.expected_life_tons ?? 0);

    const hoursUsed = percentageUsed(machine.hours_since_install, machine.expected_life_hours ?? 0);

    const measurements = [
      { label: "tonnage", percentage: tonsUsed },
      { label: "operating hours", percentage: hoursUsed },
    ].filter(
      (
        measurement,
      ): measurement is {
        label: string;
        percentage: number;
      } => measurement.percentage !== null,
    );

    if (measurements.length === 0) continue;

    const highest = measurements.reduce((current, candidate) =>
      candidate.percentage > current.percentage ? candidate : current,
    );

    if (highest.percentage < 80) continue;

    const score = Math.min(100, Math.round(highest.percentage));

    risks.push({
      id: `equipment_lifespan:${machine.id}`,
      category: "equipment_lifespan",
      severity: severityFor(score),
      score,
      title: `${machine.name} approaching expected lifespan`,
      description: `${machine.name} has used ${highest.percentage.toFixed(1)}% of its expected ${highest.label}.`,
      explanation: measurements.map(
        (measurement) =>
          `${measurement.label}: ${measurement.percentage.toFixed(1)}% of expected lifespan`,
      ),
      recommended_action:
        highest.percentage >= 100
          ? "Arrange an engineering inspection and assess whether the equipment should be replaced."
          : "Schedule an engineering inspection and review the equipment replacement plan.",
      entity: {
        type: "equipment",
        id: machine.id,
        name: machine.name,
        mine_id: machine.mine_id,
      },
      detected_at: detectedAt,
    });
  }

  return risks;
}

function maintenanceRisks(
  equipment: readonly SentinelEquipment[],
  today: string,
  detectedAt: string,
): SentinelRisk[] {
  const risks: SentinelRisk[] = [];

  for (const machine of equipment) {
    const due = serviceDue(machine, today);
    if (!due) continue;

    risks.push({
      id: `maintenance_overdue:${machine.id}:${due.reason}:${due.marker}`,
      category: "maintenance_overdue",
      severity: "high",
      score: 85,
      title: `Maintenance overdue: ${machine.name}`,
      description:
        due.reason === "date"
          ? `${machine.name} was due for service on ${due.marker}.`
          : `${machine.name} has reached its service threshold of ${due.marker} tons.`,
      explanation: [
        due.reason === "date"
          ? `Recorded service due date: ${due.marker}`
          : `Recorded service tonnage threshold: ${due.marker}`,
        "The existing REEF service-due rule identified this equipment as overdue.",
      ],
      recommended_action:
        "Arrange the required service and record the completed maintenance in REEF.",
      entity: {
        type: "equipment",
        id: machine.id,
        name: machine.name,
        mine_id: machine.mine_id,
      },
      detected_at: detectedAt,
    });
  }

  return risks;
}

function stockRisks(levels: readonly SentinelStockLevel[], detectedAt: string): SentinelRisk[] {
  const risks: SentinelRisk[] = [];

  for (const level of levels) {
    const quantity = Number(level.qty_on_hand);
    const reorderPoint = Number(level.reorder_point);

    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(reorderPoint) ||
      quantity < 0 ||
      reorderPoint < 0
    ) {
      continue;
    }

    if (quantity > reorderPoint) continue;

    const critical = quantity === 0;
    const score = critical ? 100 : 60;

    risks.push({
      id: `${critical ? "stock_critical" : "stock_low"}:${level.id}`,
      category: critical ? "stock_critical" : "stock_low",
      severity: critical ? "high" : "medium",
      score,
      title: critical
        ? `Stock depleted: ${level.stock_item.name}`
        : `Stock below reorder point: ${level.stock_item.name}`,
      description: critical
        ? `${level.stock_item.name} is out of stock at ${level.plant}.`
        : `${level.stock_item.name} has ${quantity} remaining, at or below its reorder point of ${reorderPoint}.`,
      explanation: [
        `Plant: ${level.plant}`,
        `Quantity available: ${quantity}`,
        `Reorder point: ${reorderPoint}`,
      ],
      recommended_action:
        level.reorder_qty > 0
          ? `Review purchasing and arrange replenishment of ${level.reorder_qty} ${level.stock_item.name} units.`
          : "Review the required replenishment quantity and raise a purchase request.",
      entity: {
        type: "stock_item",
        id: level.stock_item_id,
        name: level.stock_item.name,
        plant: level.plant,
      },
      detected_at: detectedAt,
    });
  }

  return risks;
}

export function assessSentinelRisks(input: SentinelInput): SentinelRisk[] {
  const detectedAt = input.detectedAt ?? new Date().toISOString();

  return [
    ...equipmentLifespanRisks(input.equipment, detectedAt),
    ...maintenanceRisks(input.equipment, input.today, detectedAt),
    ...stockRisks(input.stockLevels, detectedAt),
  ].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
