// What the matrix tester has seen pressed, kept while another page shows (the page is made anew when it comes back),
// for one keyboard (its uid): another one starts over, as does Reset.

export class MatrixTest {
  /** the matrix positions pressed since the test started or was reset ("2,3") */
  tested = $state.raw<ReadonlySet<string>>(new Set());
  #uid: string | null = null;

  follow(uid: string): void {
    if (this.#uid === uid) return;
    this.#uid = uid;
    this.reset();
  }

  reset(): void {
    this.tested = new Set();
  }
}

export const matrixTest = new MatrixTest();
