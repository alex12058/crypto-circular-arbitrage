
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

export function reverseIndex(index: number, arrayLength: number) {
  return Math.abs(index - (arrayLength - 1)) % arrayLength;
}

export function prevLoopableIndex(index: number, arrayLength: number) {
  return (arrayLength + index - 1) % arrayLength;
}

export function nextLoopableIndex(index: number, arrayLength: number) {
  return (index + 1) % arrayLength;
}

export function changeFirstIndex<T>(array: T[], newFirstIndex: number) {
  return array.slice(newFirstIndex).concat(array.slice(0, newFirstIndex));
}

export function XOR(a: boolean, b: boolean) {
  return a !== b;
}

export async function doAndLog(message: string, callback: () => any) {
  // Write the initial message
  process.stdout.write(`${message}...`);

  // Start a timer
  const start = new Date().getTime();

  // Run the functinon and get any string result
  const result = await callback();

  // Stop the timer
  const time = new Date().getTime() - start;

  // Print out any result messange and the time it took to run the function
  let resultText = result ? ` [${result}]` : '';
  while (message.length + resultText.length < 45) {
    resultText = `.${resultText}`;
  }
  const timeText = time ? `${time}ms` : '<1ms';
  process.stdout.write(`${resultText} | ${timeText}\n`);
}

export function assert(value: any, message:string) {
  if (!value) throw new Error(message);
}
