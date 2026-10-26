import { z } from 'zod'
import { canonical,digest,registry,uuid7 } from './domain.ts'
import references from '../schema/references.json' with {type:'json'}

const sha256=z.string().regex(/^[0-9a-f]{64}$/)
const integerString=z.string().regex(/^-?(0|[1-9]\d*)$/).max(40)
const timestamp=z.iso.datetime({offset:true})
export const seedRowSchema=z.object({
 table:z.string().max(80),id:uuid7,data:z.record(z.string(),z.unknown()),
 sourceCreatedAt:timestamp.nullable(),sourceUpdatedAt:timestamp.nullable(),
}).strict()
export type SeedRow=z.infer<typeof seedRowSchema>
export const seedManifestSchema=z.object({
 version:z.literal(1),jobId:uuid7,sourceSha256:sha256,contractHash:sha256,
 // Explicit cutover time; a bare SQLite wall-clock timestamp is insufficient.
 cutoverAt:timestamp,
 expectedCounts:z.record(z.string(),z.number().int().nonnegative().max(100_000_000)),
 expectedMoneyTotals:z.record(z.string(),integerString),
 chunks:z.array(z.object({index:z.number().int().nonnegative(),sha256,rowCount:z.number().int().min(1).max(500)}).strict()).max(25_000),
}).strict()
export type SeedManifest=z.infer<typeof seedManifestSchema>
export const seedContractHash=digest(canonical({version:1,registry,references}))

