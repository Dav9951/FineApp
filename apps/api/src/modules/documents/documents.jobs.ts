/**
 * Zadania w tle procesu Node — analiza dokumentu po odpowiedzi `202` (08 §2).
 *
 * Bez kolejki zadań: dwóch użytkowników, kilka dokumentów miesięcznie, jeden kontener.
 * Rejestr trzyma obietnice tylko po to, żeby testy i zamykanie serwera mogły poczekać,
 * aż skończy się to, co już ruszyło.
 */
export interface DocumentJobs {
  /**
   * Uruchamia zadanie po bieżącym żądaniu.
   *
   * @param job - Zadanie; błąd jest jego sprawą — rejestr go nie przekazuje dalej.
   */
  schedule(job: () => Promise<void>): void;
  /**
   * Czeka, aż skończą się wszystkie zadania — także te zaplanowane w trakcie czekania.
   *
   * @returns Obietnica spełniona, gdy nic nie biegnie.
   */
  idle(): Promise<void>;
}

/**
 * Tworzy rejestr zadań w tle.
 *
 * `setImmediate` oddaje sterowanie pętli zdarzeń, więc odpowiedź `202` wychodzi, zanim
 * zadanie zacznie czytać plik i wołać usługę AI.
 *
 * @returns Rejestr zadań.
 */
export function createDocumentJobs(): DocumentJobs {
  const running = new Set<Promise<void>>();
  return {
    schedule(job) {
      const promise = new Promise<void>((resolve) => {
        setImmediate(() => {
          job()
            .catch(() => undefined)
            .finally(resolve);
        });
      }).finally(() => running.delete(promise));
      running.add(promise);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
