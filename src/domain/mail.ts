/** A message read out of the watched mailbox, already decoded to plain text. */
export interface ReceivedMail {
  /** Gmail message id — stable, and the identity used for dedupe. */
  readonly id: string;
  readonly threadId: string;
  /** Decoded `From` header, e.g. `白井 太郎 <y.shirai@linkup-c3.jp>`. */
  readonly from: string;
  /** Bare address from `From`, lower-cased. Empty when the header is unparsable. */
  readonly fromAddress: string;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly bodyText: string;
  readonly attachmentNames: readonly string[];
}
