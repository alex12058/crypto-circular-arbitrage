import Exchange from "./classes/exchange";

import ccxt from "ccxt";

export function contains<T>(objectArray: T[], search: T): boolean {
  return objectArray.some((object) => object === search);
}

export function unique<T>(array: T[]) {
  const uniqueSet = new Set<T>();
  array.forEach((el) => {
    if (!uniqueSet.has(el)) uniqueSet.add(el);
  });
  return uniqueSet;
}

/** Get the new index of an array item after Array.reverse  */
export function mirrorIndex(index: number, arrayLength: number) {
  return Math.abs(index - (arrayLength - 1)) % arrayLength;
}

export function prevLoopableIndex(index: number, arrayLength: number) {
  return (arrayLength + index - 1) % arrayLength;
}

export function nextLoopableIndex(index: number, arrayLength: number) {
  return (index + 1) % arrayLength;
}

/** Cut off front of array and add to end so specified index is now index 0 */
export function changeFirstIndex<T>(array: T[], newFirstIndex: number) {
  return array.slice(newFirstIndex).concat(array.slice(0, newFirstIndex));
}

/** XOR Gate */
export function XOR(a: boolean, b: boolean) {
  return a !== b;
}

export function average(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

class LogLock {
  private locked: boolean = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      }
      else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next!();
    }
    else {
      this.locked = false;
    }
  }
}

const logLock = new LogLock();

export async function doAndLog(message: string, callback: () => any) {
  // Start a timer
  const start = new Date().getTime();

  // Run the functinon and get any string result
  const result = await callback();

  // Stop the timer
  const time = new Date().getTime() - start;

  // Acquire lock before logging
  await logLock.acquire();
  try {
    // Write the initial message
    process.stdout.write(`${message}...`);

    // Print out any result messange and the time it took to run the function
    let resultText = result ? ` [${result}]` : "";
    while (message.length + resultText.length < 60) {
      resultText = `.${resultText}`;
    }
    const timeText = time ? `${time}ms` : "<1ms";
    process.stdout.write(`${resultText} | ${timeText}\n`);
  }
  finally {
    // Release lock after logging
    logLock.release();
  }
}

export function assert(value: any, message: string) {
  if (!value) throw new Error(message);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function request<T>(callback: () => Promise<T>): Promise<T> {
  let toReturn: any;
  let lastError: any;
  for (
    let i = 0;
    i < Exchange.NUM_RETRY_ATTEMPTS
    && (!lastError || lastError instanceof ccxt.NetworkError);
    i++
  ) {
    await callback()
      .then((value: any) => {
        toReturn = value;
      })
      .catch((error) => (lastError = error));
    if (toReturn) return toReturn;
    await sleep(Exchange.RETRY_DELAY_MS);
  }
  throw lastError;
}

export function round(num: number, decimalPlaces: number) {
  const multiplier = 10 ** decimalPlaces;
  return Math.round(num * multiplier) / multiplier;
}
