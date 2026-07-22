import { Injectable, Logger } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';
import { MovementType } from '@prisma/client';
import { ReportsService } from './reports.service';
import { ExportReportType } from './dto/report-query.dto';

/**
 * A single output column: the key to read from a row, the header caption, an
 * optional width and whether the column holds a numeric value that should be
 * summed into the TOTALS row.
 */
export interface ExcelColumn {
  key: string;
  header: string;
  width?: number;
  numeric?: boolean;
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
}

const HEADER_FILL = 'FF1F4E78';
const HEADER_FONT = 'FFFFFFFF';
const TOTALS_FILL = 'FFD9E1F2';

@Injectable()
export class ExcelService {
  private readonly logger = new Logger(ExcelService.name);

  constructor(private readonly reports: ReportsService) {}

  /**
   * Build a formatted single-sheet workbook: bold filled header row, frozen
   * header pane, autofilter, sensible widths and a bold TOTALS row summing the
   * numeric columns. Returns the workbook as a Buffer.
   */
  async buildWorkbook(
    reportKey: string,
    rows: Array<Record<string, unknown>>,
    columns: ExcelColumn[],
    title: string,
  ): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.creator = 'Inventory API';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(reportKey.slice(0, 31) || 'Report');

    this.writeTitle(sheet, title, columns.length);
    const headerRowNumber = this.writeHeader(sheet, columns);
    this.writeRows(sheet, rows, columns);
    this.writeTotals(sheet, rows, columns);
    this.finishSheet(sheet, columns, headerRowNumber);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  private writeTitle(
    sheet: Worksheet,
    title: string,
    columnCount: number,
  ): void {
    const row = sheet.addRow([title]);
    row.font = { bold: true, size: 14 };
    if (columnCount > 1) {
      sheet.mergeCells(row.number, 1, row.number, columnCount);
    }
    sheet.addRow([`Generated ${new Date().toISOString()}`]).font = {
      italic: true,
      size: 9,
      color: { argb: 'FF808080' },
    };
    sheet.addRow([]);
  }

  private writeHeader(sheet: Worksheet, columns: ExcelColumn[]): number {
    const headerRow = sheet.addRow(columns.map((c) => c.header));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_FONT } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: HEADER_FILL },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF95B3D7' } },
      };
    });
    return headerRow.number;
  }

  private writeRows(
    sheet: Worksheet,
    rows: Array<Record<string, unknown>>,
    columns: ExcelColumn[],
  ): void {
    for (const row of rows) {
      const values = columns.map((c) => this.cellValue(row[c.key]));
      const added = sheet.addRow(values);
      columns.forEach((col, index) => {
        if (col.numeric) {
          added.getCell(index + 1).numFmt = '#,##0.00';
        }
      });
    }
  }

  private writeTotals(
    sheet: Worksheet,
    rows: Array<Record<string, unknown>>,
    columns: ExcelColumn[],
  ): void {
    const hasNumeric = columns.some((c) => c.numeric);
    if (!hasNumeric) return;

    const totalsValues = columns.map((col, index) => {
      if (index === 0) return 'TOTALS';
      if (!col.numeric) return '';
      return rows.reduce((sum, row) => {
        const value = Number(row[col.key]);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
    });

    const totalsRow = sheet.addRow(totalsValues);
    totalsRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TOTALS_FILL },
      };
      if (columns[colNumber - 1]?.numeric) {
        cell.numFmt = '#,##0.00';
      }
    });
  }

  private finishSheet(
    sheet: Worksheet,
    columns: ExcelColumn[],
    headerRowNumber: number,
  ): void {
    columns.forEach((col, index) => {
      sheet.getColumn(index + 1).width = col.width ?? 18;
    });

    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: columns.length },
    };

    sheet.views = [
      {
        state: 'frozen',
        ySplit: headerRowNumber,
      },
    ];
  }

  private cellValue(value: unknown): string | number | Date | null {
    if (value === null || value === undefined) return null;
    if (
      typeof value === 'number' ||
      typeof value === 'string' ||
      value instanceof Date
    ) {
      return value;
    }
    return String(value);
  }

  // ── Dataset selection + export ──────────────────────────────

  /**
   * Fetch the dataset for `type`, flatten it to rows/columns and render the
   * workbook. Returns the buffer and a suggested filename.
   */
  async exportReport(
    type: ExportReportType,
    filter: {
      warehouseId?: string;
      categoryId?: string;
      method?: import('@prisma/client').ValuationMethod;
      from?: string;
      to?: string;
      movementType?: MovementType;
      variantId?: string;
      days?: number;
    },
  ): Promise<ExportResult> {
    const stamp = new Date().toISOString().slice(0, 10);

    switch (type) {
      case 'stock-valuation': {
        const report = await this.reports.stockValuation({
          warehouseId: filter.warehouseId,
          categoryId: filter.categoryId,
          method: filter.method,
        });
        const columns: ExcelColumn[] = [
          { key: 'variantSku', header: 'SKU', width: 20 },
          { key: 'variantName', header: 'Variant', width: 28 },
          { key: 'productName', header: 'Product', width: 28 },
          { key: 'categoryName', header: 'Category', width: 20 },
          { key: 'warehouseName', header: 'Warehouse', width: 20 },
          { key: 'method', header: 'Method', width: 18 },
          { key: 'quantity', header: 'Quantity', width: 14, numeric: true },
          { key: 'unitCost', header: 'Unit Cost', width: 14, numeric: true },
          { key: 'totalValue', header: 'Total Value', width: 16, numeric: true },
        ];
        const buffer = await this.buildWorkbook(
          'Stock Valuation',
          report.rows as unknown as Array<Record<string, unknown>>,
          columns,
          'Stock Valuation Report',
        );
        return { buffer, filename: `stock-valuation-${stamp}.xlsx` };
      }

      case 'movement-summary': {
        const report = await this.reports.movementSummary({
          from: filter.from,
          to: filter.to,
          warehouseId: filter.warehouseId,
          type: filter.movementType,
          variantId: filter.variantId,
        });
        const columns: ExcelColumn[] = [
          { key: 'createdAt', header: 'Date', width: 24 },
          { key: 'type', header: 'Type', width: 16 },
          { key: 'variantSku', header: 'SKU', width: 20 },
          { key: 'variantName', header: 'Variant', width: 28 },
          { key: 'warehouseName', header: 'Warehouse', width: 20 },
          { key: 'quantity', header: 'Quantity', width: 14, numeric: true },
          { key: 'unitCost', header: 'Unit Cost', width: 14, numeric: true },
        ];
        const buffer = await this.buildWorkbook(
          'Movement Summary',
          report.movements as unknown as Array<Record<string, unknown>>,
          columns,
          'Movement Summary Report',
        );
        return { buffer, filename: `movement-summary-${stamp}.xlsx` };
      }

      case 'low-stock': {
        const rows = await this.reports.lowStock();
        const columns: ExcelColumn[] = [
          { key: 'variantSku', header: 'SKU', width: 20 },
          { key: 'variantName', header: 'Variant', width: 28 },
          { key: 'warehouseName', header: 'Warehouse', width: 20 },
          { key: 'physical', header: 'Physical', width: 14, numeric: true },
          { key: 'reserved', header: 'Reserved', width: 14, numeric: true },
          { key: 'available', header: 'Available', width: 14, numeric: true },
          {
            key: 'reorderPoint',
            header: 'Reorder Point',
            width: 16,
            numeric: true,
          },
          {
            key: 'reorderQuantity',
            header: 'Reorder Qty',
            width: 16,
            numeric: true,
          },
        ];
        const buffer = await this.buildWorkbook(
          'Low Stock',
          rows as unknown as Array<Record<string, unknown>>,
          columns,
          'Low Stock Report',
        );
        return { buffer, filename: `low-stock-${stamp}.xlsx` };
      }

      case 'expiring-batches': {
        const rows = await this.reports.expiringBatches(filter.days ?? 30);
        const columns: ExcelColumn[] = [
          { key: 'batchNumber', header: 'Batch', width: 20 },
          { key: 'variantSku', header: 'SKU', width: 20 },
          { key: 'variantName', header: 'Variant', width: 28 },
          { key: 'warehouseName', header: 'Warehouse', width: 20 },
          {
            key: 'quantityRemaining',
            header: 'Qty Remaining',
            width: 16,
            numeric: true,
          },
          { key: 'expiryDate', header: 'Expiry Date', width: 24 },
          {
            key: 'daysUntilExpiry',
            header: 'Days To Expiry',
            width: 16,
            numeric: true,
          },
        ];
        const buffer = await this.buildWorkbook(
          'Expiring Batches',
          rows as unknown as Array<Record<string, unknown>>,
          columns,
          'Expiring Batches Report',
        );
        return { buffer, filename: `expiring-batches-${stamp}.xlsx` };
      }

      default: {
        // Exhaustiveness guard — a new report type must be handled above.
        const exhaustive: never = type;
        throw new Error(`Unsupported report type: ${String(exhaustive)}`);
      }
    }
  }
}
