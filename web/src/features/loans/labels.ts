import { T } from "../../i18n"
import { rateToPct } from "./math"

/** 360 → "30 年", 18 → "18 個月". */
export const fmtTerm = (m: number) => (m % 12 === 0 ? T`${m / 12} 年` : T`${m} 個月`)

/** 0.02185 → "2.185%", 0.021 → "2.1%". */
export const fmtRate = (rate: number) => `${rateToPct(rate)}%`
