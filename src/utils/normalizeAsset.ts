
export function normalizeAsset(inputScale: number, outputScale: number, value: number): number {
    const scaleDifference = outputScale - inputScale
    return Math.ceil(value*Math.pow(10,scaleDifference))
}