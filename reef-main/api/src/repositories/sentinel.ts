import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../http/errors.js";
import type { SentinelEquipment, SentinelStockLevel } from "../services/sentinel-risk.js";
import type { UserContext } from "./types.js";

export type SentinelAssessmentData = {
  equipment: SentinelEquipment[];
  stockLevels: SentinelStockLevel[];
};

export interface SentinelRepository {
  assessData(user: UserContext): Promise<SentinelAssessmentData>;
}

type EquipmentRow = {
  id: string;
  name: string;
  mine_id: string | null;
  status: string;
  install_date: string | null;
  tons_since_install: number | string;
  hours_since_install: number | string;
  expected_life_tons: number | string | null;
  expected_life_hours: number | string | null;
  service_interval_days: number | string | null;
  service_interval_tons: number | string | null;
};

type MaintenanceRow = {
  equipment_id: string;
  date: string;
  next_due_date: string | null;
  next_due_tons: number | string | null;
};

type StockItemRelation = {
  name: string;
  sku: string | null;
};

type StockRow = {
  id: string;
  stock_item_id: string;
  plant: string;
  qty_on_hand: number | string;
  reorder_point: number | string;
  reorder_qty: number | string;
  stock_item: StockItemRelation | StockItemRelation[] | null;
};

function failDatabase(error: { message: string }): never {
  throw new ApiError("INTERNAL", error.message);
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class SupabaseSentinelRepository implements SentinelRepository {
  constructor(private readonly db: SupabaseClient) {}

  async assessData(user: UserContext): Promise<SentinelAssessmentData> {
    if (user.role !== "owner" && !user.plant) {
      return { equipment: [], stockLevels: [] };
    }

    // Equipment is connected to a plant through its mine.
    let mineQuery = this.db.from("mines").select("id");

    if (user.role !== "owner") {
      mineQuery = mineQuery.eq("plant", user.plant);
    }

    const { data: mines, error: mineError } = await mineQuery;

    if (mineError) failDatabase(mineError);

    const mineIds = (mines ?? []).map((mine) => mine.id);

    let equipment: SentinelEquipment[] = [];

    // A non-owner only sees equipment attached to mines at their plant.
    // An owner can see all equipment, including equipment not yet assigned to a mine.
    if (user.role === "owner" || mineIds.length > 0) {
      let equipmentQuery = this.db
        .from("equipment")
        .select(
          "id, name, mine_id, status, install_date, tons_since_install, hours_since_install, expected_life_tons, expected_life_hours, service_interval_days, service_interval_tons",
        );

      if (user.role !== "owner") {
        equipmentQuery = equipmentQuery.in("mine_id", mineIds);
      }

      const { data: equipmentRows, error: equipmentError } = await equipmentQuery;

      if (equipmentError) failDatabase(equipmentError);

      const rows = (equipmentRows ?? []) as unknown as EquipmentRow[];

      if (rows.length > 0) {
        const equipmentIds = rows.map((row) => row.id);

        const { data: maintenanceRows, error: maintenanceError } = await this.db
          .from("maintenance_logs")
          .select("equipment_id, date, next_due_date, next_due_tons")
          .in("equipment_id", equipmentIds)
          .order("date", { ascending: false });

        if (maintenanceError) failDatabase(maintenanceError);

        const latestMaintenance = new Map<string, MaintenanceRow>();

        for (const log of (maintenanceRows ?? []) as unknown as MaintenanceRow[]) {
          if (!latestMaintenance.has(log.equipment_id)) {
            latestMaintenance.set(log.equipment_id, log);
          }
        }

        equipment = rows.map((row): SentinelEquipment => {
          const latest = latestMaintenance.get(row.id);

          return {
            id: row.id,
            name: row.name,
            mine_id: row.mine_id,
            status: row.status,
            install_date: row.install_date,
            tons_since_install: Number(row.tons_since_install),
            hours_since_install: Number(row.hours_since_install),
            expected_life_tons: numberOrNull(row.expected_life_tons),
            expected_life_hours: numberOrNull(row.expected_life_hours),
            service_interval_days: numberOrNull(row.service_interval_days),
            service_interval_tons: numberOrNull(row.service_interval_tons),
            next_due_date: latest?.next_due_date ?? null,
            next_due_tons: numberOrNull(latest?.next_due_tons ?? null),
            last_serviced_on: latest?.date ?? null,
          };
        });
      }
    }

    // Stock levels are already plant-scoped by their own plant column and RLS.
    let stockQuery = this.db
      .from("stock_levels")
      .select(
        "id, stock_item_id, plant, qty_on_hand, reorder_point, reorder_qty, stock_item:stock_items(name, sku)",
      );

    if (user.role !== "owner") {
      stockQuery = stockQuery.eq("plant", user.plant);
    }

    const { data: stockRows, error: stockError } = await stockQuery;

    if (stockError) failDatabase(stockError);

    const stockLevels: SentinelStockLevel[] = [];

    for (const row of (stockRows ?? []) as unknown as StockRow[]) {
      const relation = row.stock_item;
      const item = Array.isArray(relation) ? relation[0] : relation;

      if (!item) continue;

      stockLevels.push({
        id: row.id,
        stock_item_id: row.stock_item_id,
        plant: row.plant,
        qty_on_hand: Number(row.qty_on_hand),
        reorder_point: Number(row.reorder_point),
        reorder_qty: Number(row.reorder_qty),
        stock_item: {
          name: item.name,
          sku: item.sku,
        },
      });
    }

    return { equipment, stockLevels };
  }
}
