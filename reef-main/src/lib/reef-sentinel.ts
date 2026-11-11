
type RiskLevel = "High" | "Medium" | "Low";

type RiskCategory =
  | "Equipment"
  | "Maintenance"
  | "Inventory"
  | "Downtime"
  | "Production";

type SentinelRisk = {
  id: string;
  level: RiskLevel;
  category: RiskCategory;
  title: string;
  asset: string;
  evidence: string;
  score: number;
  likelihood: number;
  impact: number;
  recommendedAction: string;
  detectedAt: string;
};

type Row = Record<string, unknown>;

type DetectReefRisksInput = {
  equipment?: readonly Row[];
  maintenance?: readonly Row[];
  stock?: readonly Row[];
  downtime?: readonly Row[];
  production?: readonly Row[];
  mines?: readonly Row[];
};

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function riskLevel(score: number): RiskLevel {
  if (score >= 15) return "High";
  if (score >= 6) return "Medium";
  return "Low";
}

function addDays(date: string, days: number): string | null {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function maintenanceDue(
  machine: Row,
  logs: readonly Row[],
  today: string,
): string | null {
  const machineId = stringValue(machine.id);

  const machineLogs = logs
    .filter((log) => stringValue(log.equipment_id) === machineId)
    .sort((a, b) =>
      stringValue(b.date).localeCompare(stringValue(a.date)),
    );

  const latestLog = machineLogs[0];

  const nextDueDate =
    stringValue(machine.next_due_date) ||
    stringValue(latestLog?.next_due_date);

  const nextDueTons =
    numberValue(machine.next_due_tons) ??
    numberValue(latestLog?.next_due_tons);

  let dueDate = nextDueDate || null;

  if (!dueDate) {
    const lastServiced =
      stringValue(machine.last_serviced_on) ||
      stringValue(latestLog?.date);

    const installDate = stringValue(machine.install_date);
    const intervalDays = numberValue(machine.service_interval_days);

    if (intervalDays && intervalDays > 0) {
      if (lastServiced) {
        dueDate = addDays(lastServiced, intervalDays);
      } else if (installDate) {
        dueDate = addDays(installDate, intervalDays);
      }
    }
  }

  if (dueDate && today >= dueDate) {
    return `Service due date ${dueDate} has been reached.`;
  }

  const tonsUsed = numberValue(machine.tons_since_install) ?? 0;
  const tonsThreshold =
    nextDueTons ?? numberValue(machine.service_interval_tons);

  if (
    tonsThreshold !== null &&
    tonsThreshold > 0 &&
    tonsUsed >= tonsThreshold
  ) {
    return `Equipment has reached its service tonnage threshold of ${tonsThreshold.toFixed(2)} tons.`;
  }

  return null;
}

export function detectReefRisks(
  input: DetectReefRisksInput,
): SentinelRisk[] {
  const risks: SentinelRisk[] = [];
  const detectedAt = new Date().toISOString();
  const today = detectedAt.slice(0, 10);

  const equipment = input.equipment ?? [];
  const maintenance = input.maintenance ?? [];
  const stock = input.stock ?? [];

  for (const machine of equipment) {
    const id = stringValue(machine.id);
    const name = stringValue(machine.name) || "Unnamed equipment";
    const status = stringValue(machine.status).toLowerCase();

    if (!id || status !== "active") continue;

    const tonsUsed = numberValue(machine.tons_since_install);
    const expectedTons = numberValue(machine.expected_life_tons);
    const hoursUsed = numberValue(machine.hours_since_install);
    const expectedHours = numberValue(machine.expected_life_hours);

    const measurements: Array<{ label: string; percentage: number }> = [];

    if (
      tonsUsed !== null &&
      expectedTons !== null &&
      expectedTons > 0
    ) {
      measurements.push({
        label: "expected tonnage",
        percentage: Math.max(0, (tonsUsed / expectedTons) * 100),
      });
    }

    if (
      hoursUsed !== null &&
      expectedHours !== null &&
      expectedHours > 0
    ) {
      measurements.push({
        label: "expected operating hours",
        percentage: Math.max(0, (hoursUsed / expectedHours) * 100),
      });
    }

    if (measurements.length > 0) {
      const highest = measurements.reduce((a, b) =>
        b.percentage > a.percentage ? b : a,
      );

      if (highest.percentage >= 80) {
        const likelihood =
          highest.percentage >= 100
            ? 5
            : highest.percentage >= 90
              ? 4
              : 3;

        const impact = highest.percentage >= 100 ? 5 : 4;
        const score = likelihood * impact;

        risks.push({
          id: `equipment_lifespan:${id}`,
          level: riskLevel(score),
          category: "Equipment",
          title: `${name} approaching expected lifespan`,
          asset: name,
          evidence: `${highest.percentage.toFixed(1)}% of ${highest.label} has been used.`,
          score,
          likelihood,
          impact,
          recommendedAction:
            highest.percentage >= 100
              ? "Arrange an engineering inspection and assess whether this equipment should be replaced."
              : "Schedule an engineering inspection and review the equipment replacement plan.",
          detectedAt,
        });
      }
    }

    const overdueReason = maintenanceDue(machine, maintenance, today);

    if (overdueReason) {
      risks.push({
        id: `maintenance_overdue:${id}`,
        level: "High",
        category: "Maintenance",
        title: `Maintenance overdue: ${name}`,
        asset: name,
        evidence: overdueReason,
        score: 25,
        likelihood: 5,
        impact: 5,
        recommendedAction:
          "Arrange the required service and record the completed maintenance in REEF.",
        detectedAt,
      });
    }
  }

  for (const item of stock) {
    const id = stringValue(item.id);
    const name = stringValue(item.name) || "Unnamed stock item";
    const quantity = numberValue(item.qty_on_hand);
    const reorderPoint = numberValue(item.reorder_point);

    if (
      !id ||
      quantity === null ||
      reorderPoint === null ||
      quantity < 0 ||
      reorderPoint < 0 ||
      quantity > reorderPoint
    ) {
      continue;
    }

    const depleted = quantity === 0;
    const likelihood = depleted ? 5 : 4;
    const impact = depleted ? 5 : 4;
    const score = likelihood * impact;
    const reorderQty = numberValue(item.reorder_qty) ?? 0;
    const plant = stringValue(item.plant);

    risks.push({
      id: `inventory:${id}`,
      level: riskLevel(score),
      category: "Inventory",
      title: depleted
        ? `Stock depleted: ${name}`
        : `Stock below reorder point: ${name}`,
      asset: plant ? `${name} · ${plant}` : name,
      evidence: depleted
        ? `No stock remains. Reorder point: ${reorderPoint}.`
        : `${quantity} units remain against a reorder point of ${reorderPoint}.`,
      score,
      likelihood,
      impact,
      recommendedAction:
        reorderQty > 0
          ? `Review purchasing and arrange replenishment of ${reorderQty} ${name} units.`
          : "Review the replenishment quantity and raise a purchase request.",
      detectedAt,
    });
  }

  return risks.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title),
  );
}

export type { RiskLevel, SentinelRisk };
