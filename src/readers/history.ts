export type ReaderPosition =
  | { format: "pdf"; page: number; offset: number; scrollTop: number; scrollLeft: number }
  | { format: "epub"; cfi: string; label: string };
/** Temporary navigation has its own cursor. It never becomes reading progress
 * until the user explicitly adopts it or returns to normal reading. */
export class ReaderHistory {
  private entries: ReaderPosition[] = [];
  private cursor = 0;
  private origin: ReaderPosition | undefined;
  get canBack(): boolean { return this.cursor > 0; }
  get canForward(): boolean { return this.cursor < this.entries.length - 1; }
  get temporary(): boolean { return this.cursor > 0; }
  get readingOrigin(): ReaderPosition | undefined { return this.origin ? { ...this.origin } : undefined; }
  commit(position?: ReaderPosition): void { this.entries = position ? [{ ...position }] : []; this.cursor = 0; this.origin = position ? { ...position } : undefined; }
  jump(from: ReaderPosition, to: ReaderPosition): void {
    if (!this.entries.length) this.commit(from);
    this.entries[this.cursor] = { ...from };
    if (this.cursor === 0) this.origin = { ...from };
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push({ ...to }); this.cursor++;
    if (this.entries.length > 50) { this.entries.splice(1, 1); this.cursor--; }
  }
  observe(position: ReaderPosition): void {
    if (this.temporary) this.entries[this.cursor] = { ...position };
    else if (!this.canForward) this.commit(position);
    else { this.entries[0] = { ...position }; this.origin = { ...position }; }
  }
  back(): ReaderPosition | undefined { return this.canBack ? { ...this.entries[--this.cursor] } : undefined; }
  forward(): ReaderPosition | undefined { return this.canForward ? { ...this.entries[++this.cursor] } : undefined; }
  returnToReading(): ReaderPosition | undefined {
    const position = this.readingOrigin; if (position) this.commit(position); return position;
  }
}
