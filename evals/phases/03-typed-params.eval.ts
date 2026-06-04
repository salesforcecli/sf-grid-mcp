import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evalEnvOrSkip } from "../fixtures/env.js";
import { buildClient, createSuiteWorkbook, cleanupSuiteWorkbook } from "../fixtures/setup.js";
import type { GridClient } from "../../src/client.js";

/**
 * Phase 3 — Typed Bucket C.1 paths: cell, discover, column-mutation typed params.
 *
 * Locks in the Bucket C.1 typed-array / typed-object code paths that landed in
 * W-22702496. Each test calls Core through the same endpoints the MCP tool
 * dispatches to and asserts on the response shape.
 */
describe("Phase 3: typed params (Bucket C.1)", () => {
  const env = evalEnvOrSkip("phase-3-typed-params");
  if (!env) {
    it.skip("skipped — env not set", () => {});
    return;
  }

  let client: GridClient;
  let workbookId: string | undefined;
  let worksheetId: string;
  let textColumnId: string;
  let cellIds: string[];   // for cell.update — keys cells by cell ID
  let rowIds: string[];    // for cell.paste — keys cells by row ID

  beforeAll(async () => {
    client = buildClient(env);
    const ids = await createSuiteWorkbook(client, "phase-3");
    workbookId = ids.workbookId;
    worksheetId = ids.worksheetId;

    // Add a Text column we can paste/update against. Text columns don't
    // trigger Core-side processing so this is a fast, cheap fixture.
    const textCol = await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns`,
      {
        name: "Notes",
        type: "Text",
        config: {
          type: "Text",
          queryResponseFormat: { type: "EACH_ROW" },
          autoUpdate: true,
          config: { autoUpdate: true },
        },
      }
    );
    textColumnId = textCol.id;

    // Read both cell IDs (for update) and row IDs (for paste) from the
    // worksheet's seeded rows.
    const ws = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
    const cells = (ws.columnData?.[textColumnId] as Array<{ id: string; worksheetRowId: string }> | undefined) ?? [];
    cellIds = cells.map((c) => c.id);
    rowIds = cells.map((c) => c.worksheetRowId);
    if (cellIds.length < 3) {
      throw new Error(`Phase 3 setup: need ≥3 rows, got ${cellIds.length}`);
    }
  }, 30_000);

  afterAll(async () => {
    await cleanupSuiteWorkbook(client, workbookId);
  });

  it("cell.update accepts a typed array of cell objects", async () => {
    // The MCP cell.update tool builds this body shape; we hit the same endpoint.
    // `id` here is the cell ID (not row ID).
    await client.put(`/worksheets/${encodeURIComponent(worksheetId)}/cells`, {
      cells: [
        { id: cellIds[0], fullContent: { text: "Note one — typed array." } },
        { id: cellIds[1], fullContent: { text: "Note two — also typed." } },
      ],
    });

    // Read back via the column-level endpoint, which preserves `fullContent`
    // intact. The worksheet-level `/data` endpoint truncates `fullContent` and
    // HTML-escapes the rendered form into `displayContent` instead.
    const colData = await client.get(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(textColumnId)}/data`
    );
    const cells = (colData.cells as Array<{ id: string; fullContent?: { text?: string } }>) ?? [];
    const c0 = cells.find((c) => c.id === cellIds[0]);
    const c1 = cells.find((c) => c.id === cellIds[1]);
    expect(c0?.fullContent?.text).toBe("Note one — typed array.");
    expect(c1?.fullContent?.text).toBe("Note two — also typed.");
  });

  it("cell.paste accepts a typed 2D matrix", async () => {
    // paste takes startRowId (worksheet row ID), not cell ID.
    await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/paste`, {
      startColumnId: textColumnId,
      startRowId: rowIds[2],
      matrix: [
        [{ displayContent: "pasted-row-3" }],
      ],
    });

    const ws = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
    const cells = (ws.columnData?.[textColumnId] as Array<{ worksheetRowId: string; displayContent?: string }>) ?? [];
    const c2 = cells.find((c) => c.worksheetRowId === rowIds[2]);
    expect(c2?.displayContent).toBe("pasted-row-3");
  });

  it("discover.sobject_fields_display accepts a typed array of SObject names", async () => {
    const result = await client.post("/sobjects/fields-display", {
      sobjectList: ["Account"],
    });
    expect(result.fieldMap).toBeTruthy();
    expect(Array.isArray(result.fieldMap.Account)).toBe(true);
    expect(result.fieldMap.Account.length).toBeGreaterThan(0);
    // Every field carries the expected shape.
    const f = result.fieldMap.Account[0];
    expect(typeof f.apiName).toBe("string");
    expect(typeof f.dataType).toBe("string");
  });

  it("column_mutation.update_filters typed-array path normalizes scalar values", async () => {
    // Add an Object column to mutate.
    const objCol = await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns`,
      {
        name: "Account Lookup",
        type: "Object",
        config: {
          type: "Object",
          queryResponseFormat: { type: "EACH_ROW" },
          autoUpdate: true,
          config: {
            autoUpdate: true,
            objectApiName: "Account",
            fields: [
              { name: "Id", type: "ID" },
              { name: "Name", type: "STRING" },
              { name: "Industry", type: "PICKLIST" },
            ],
          },
        },
      }
    );
    const objColumnId = objCol.id;

    // Build the typed inner config that update_filters synthesizes when given
    // a scalar values array.
    const innerConfig = {
      type: "Object",
      queryResponseFormat: { type: "EACH_ROW" },
      autoUpdate: true,
      config: {
        autoUpdate: true,
        objectApiName: "Account",
        fields: [
          { name: "Id", type: "ID" },
          { name: "Name", type: "STRING" },
          { name: "Industry", type: "PICKLIST" },
        ],
        filters: [
          {
            field: "Industry",
            operator: "IN",
            // Pre-wrap into Core's expected {value, type} shape — the
            // normalizeFilterValues helper does this for the MCP tool.
            values: [
              { value: "Technology", type: "STRING" },
              { value: "Finance", type: "STRING" },
            ],
          },
        ],
      },
    };

    const saved = await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(objColumnId)}/save`,
      {
        name: "Account Lookup",
        type: "Object",
        config: innerConfig,
      }
    );

    // Verify the filter persisted with the wrapped shape.
    const filters = saved.config?.filters;
    expect(Array.isArray(filters)).toBe(true);
    expect(filters.length).toBe(1);
    expect(filters[0].field).toBe("Industry");
    expect(filters[0].operator).toBe("IN");
    expect(filters[0].values).toHaveLength(2);
    expect(filters[0].values[0].value).toBe("Technology");
    expect(filters[0].values[1].value).toBe("Finance");
  });
});
