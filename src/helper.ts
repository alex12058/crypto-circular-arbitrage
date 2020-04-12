
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
  process.stdout.write(`${message}...`);
  const start = new Date().getTime();
  await callback();
  const time = new Date().getTime() - start;
  process.stdout.write(` [${time}ms]\n`);
}
