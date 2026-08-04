export interface TableReport {
  table: string;
  sourceCount: number;
  /** Rows actually written. Equals 0 in --dry-run mode even when sourceCount > 0. */
  upserted: number;
}

export interface DomainReport {
  domain: string;
  tables: TableReport[];
  warnings: string[];
}

export function printDomainReport(report: DomainReport, dryRun: boolean): void {
  console.log(`\n── ${report.domain} ${dryRun ? "(dry run)" : ""} ──`);
  for (const t of report.tables) {
    const verb = dryRun ? "would upsert" : "upserted";
    console.log(`  ${t.table.padEnd(32)} source=${t.sourceCount}  ${verb}=${t.upserted}`);
  }
  for (const w of report.warnings) {
    console.log(`  ⚠  ${w}`);
  }
}
