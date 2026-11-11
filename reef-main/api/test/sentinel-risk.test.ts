
import { describe, expect, it } from "vitest";
import {
  assessSentinelRisks,
  type SentinelEquipment,
  type SentinelInput,
  type SentinelStockLevel,
} from "../src/services/sentinel-risk.js";

const detectedAt = "2026-11-11T08:00:00.000Z";
const today = "2026-11-11";

function equipment(
  overrides: Partial<SentinelEquipment> = {},
): SentinelEquipment {
  return {
    id: "equipment-001",
    name: "Primary Crusher",
    mine_id: "mine-001",
    status: "active",
    install_date: "2024-01-01",
    tons_since_install: 7000,
    service_interval_days: null,
    service_interval_tons: null,
    next_due_date: null,
    next_due_tons: null,
    last_serviced_on: null,
    expected_life_tons: 10000,
    expected_life_hours: 20000,
    hours_since_install: 10000,
    ...overrides,
  };
}

function stockLevel(
  overrides: Partial<SentinelStockLevel> = {},
): SentinelStockLevel {
  return {
    id: "stock-level-001",
    stock_item_id: "stock-item-001",
    plant: "Mokopane Plant 1",
    qty_on_hand: 5,
    reorder_point: 10,
    reorder_qty: 20,
    stock_item: {
      name: "Crusher Bearings",
      sku: "CB-001",
    },
    ...overrides,
  };
}

function input(overrides: Partial<SentinelInput> = {}): SentinelInput {
  return {
    equipment: [],
    stockLevels: [],
    today,
    detectedAt,
    ...overrides,
  };
}

describe("REEF Sentinel risk engine", () => {
  describe("equipment lifespan", () => {
    it("flags equipment when expected lifespan usage reaches 80%", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              tons_since_install: 8000,
              expected_life_tons: 10000,
            }),
          ],
        }),
      );

      const risk = risks.find(
        (item) => item.category === "equipment_lifespan",
      );

      expect(risk).toBeDefined();
      expect(risk?.score).toBe(80);
      expect(risk?.severity).toBe("high");
      expect(risk?.entity.id).toBe("equipment-001");
    });

    it("does not flag equipment below the 80% threshold", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              tons_since_install: 7999,
              expected_life_tons: 10000,
              hours_since_install: 0,
            }),
          ],
        }),
      );

      expect(
        risks.some((item) => item.category === "equipment_lifespan"),
      ).toBe(false);
    });

    it("uses the highest valid lifespan measurement", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              tons_since_install: 5000,
              expected_life_tons: 10000,
              hours_since_install: 18000,
              expected_life_hours: 20000,
            }),
          ],
        }),
      );

      const risk = risks.find(
        (item) => item.category === "equipment_lifespan",
      );

      expect(risk?.score).toBe(90);
      expect(risk?.explanation).toContain(
        "operating hours: 90.0% of expected lifespan",
      );
    });

    it("does not flag inactive equipment", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              status: "retired",
              tons_since_install: 10000,
              expected_life_tons: 10000,
            }),
          ],
        }),
      );

      expect(
        risks.some((item) => item.category === "equipment_lifespan"),
      ).toBe(false);
    });

    it("does not calculate a lifespan risk when no valid limit exists", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              expected_life_tons: null,
              expected_life_hours: null,
            }),
          ],
        }),
      );

      expect(
        risks.some((item) => item.category === "equipment_lifespan"),
      ).toBe(false);
    });
  });

  describe("maintenance", () => {
    it("flags equipment whose recorded service date is overdue", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              next_due_date: "2026-11-10",
              service_interval_days: null,
            }),
          ],
        }),
      );

      const risk = risks.find(
        (item) => item.category === "maintenance_overdue",
      );

      expect(risk).toBeDefined();
      expect(risk?.severity).toBe("high");
      expect(risk?.score).toBe(85);
      expect(risk?.explanation).toContain(
        "Recorded service due date: 2026-11-10",
      );
    });

    it("does not flag equipment before its service due date", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              next_due_date: "2026-11-12",
              service_interval_days: null,
            }),
          ],
        }),
      );

      expect(
        risks.some((item) => item.category === "maintenance_overdue"),
      ).toBe(false);
    });

    it("does not flag inactive equipment for overdue maintenance", () => {
      const risks = assessSentinelRisks(
        input({
          equipment: [
            equipment({
              status: "retired",
              next_due_date: "2026-10-01",
            }),
          ],
        }),
      );

      expect(
        risks.some((item) => item.category === "maintenance_overdue"),
      ).toBe(false);
    });
  });

  describe("stock levels", () => {
    it("classifies depleted stock as high risk", () => {
      const risks = assessSentinelRisks(
        input({
          stockLevels: [stockLevel({ qty_on_hand: 0 })],
        }),
      );

      const risk = risks.find(
        (item) => item.category === "stock_critical",
      );

      expect(risk).toBeDefined();
      expect(risk?.score).toBe(100);
      expect(risk?.severity).toBe("high");
    });

    it("classifies stock at its reorder point as medium risk", () => {
      const risks = assessSentinelRisks(
        input({
          stockLevels: [
            stockLevel({
              qty_on_hand: 10,
              reorder_point: 10,
            }),
          ],
        }),
      );

      const risk = risks.find(
        (item) => item.category === "stock_low",
      );

      expect(risk).toBeDefined();
      expect(risk?.score).toBe(60);
      expect(risk?.severity).toBe("medium");
    });

    it("does not flag stock above its reorder point", () => {
      const risks = assessSentinelRisks(
        input({
          stockLevels: [
            stockLevel({
              qty_on_hand: 11,
              reorder_point: 10,
            }),
          ],
        }),
      );

      expect(risks).toHaveLength(0);
    });

    it("ignores invalid negative stock quantities", () => {
      const risks = assessSentinelRisks(
        input({
          stockLevels: [
            stockLevel({
              qty_on_hand: -1,
            }),
          ],
        }),
      );

      expect(risks).toHaveLength(0);
    });
  });

  describe("risk ordering and output", () => {
    it("sorts risks from highest to lowest score", () => {
      const risks = assessSentinelRisks(
        input({
          stockLevels: [
            stockLevel({ id: "stock-1", qty_on_hand: 5 }),
            stockLevel({
              id: "stock-2",
              qty_on_hand: 0,
            }),
          ],
          equipment: [
            equipment({
              tons_since_install: 8000,
              expected_life_tons: 10000,
            }),
          ],
        }),
      );

      expect(risks.map((risk) => risk.score)).toEqual([100, 80, 60]);
    });

    it("includes a detection timestamp on every risk", () => {
      const risks = assessSentinelRisks(
        input({
          stockLevels: [stockLevel({ qty_on_hand: 0 })],
        }),
      );

      expect(risks[0]?.detected_at).toBe(detectedAt);
    });

    it("returns an empty list when there are no identified risks", () => {
      expect(assessSentinelRisks(input())).toEqual([]);
    });
  });
});
