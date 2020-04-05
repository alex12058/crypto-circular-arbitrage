
export function contains<T>(objectArray: T[], search: T): boolean {
    return objectArray.indexOf(search) !== -1;
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