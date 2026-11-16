/** Report lifecycle (GEN-09, GEN-10), shared by the schema, DTOs and controllers. */
export enum ReportStatus {
  Open = 'OPEN',
  /** An admin dismissed this report; the content was left alone. */
  Dismissed = 'DISMISSED',
  /** The content was hidden or deleted (through this report, another one, or directly). */
  Actioned = 'ACTIONED',
}

export enum ReportAction {
  Dismiss = 'DISMISS',
  Hide = 'HIDE',
  Delete = 'DELETE',
}
