import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { relationsToTypeScript, schemaImportFor } from '../../src/cli/commands/pull-common';
import type { SchemaForPull } from '../../src/cli/commands/pull-common';
import { tsc } from '../utils';

const pkg = (dir: string, type?: string) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify(type ? { type } : {}));
};

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'drizzle-kit-relations-import-'));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

test('an ES module project gets an explicit extension on the schema import', () => {
	const out = join(root, 'esm', 'drizzle');
	pkg(join(root, 'esm'), 'module');

	expect(schemaImportFor(out)).toBe('./schema.js');
});

test('a CommonJS project keeps the extensionless schema import', () => {
	pkg(join(root, 'cjs'), 'commonjs');
	pkg(join(root, 'untyped'));

	expect(schemaImportFor(join(root, 'cjs', 'drizzle'))).toBe('./schema');
	expect(schemaImportFor(join(root, 'untyped', 'drizzle'))).toBe('./schema');
});

test('the nearest package.json decides, as it does for Node', () => {
	pkg(join(root, 'nested'), 'module');
	pkg(join(root, 'nested', 'legacy'), 'commonjs');

	expect(schemaImportFor(join(root, 'nested', 'legacy', 'drizzle'))).toBe('./schema');
	expect(schemaImportFor(join(root, 'nested', 'drizzle'))).toBe('./schema.js');
});

test('a folder with no package.json above it keeps the extensionless import', () => {
	expect(schemaImportFor(join(root, 'bare', 'drizzle'))).toBe('./schema');
});

test('relations.ts imports the schema through the resolved specifier', () => {
	const schema: SchemaForPull = [
		{ schema: 'public', foreignKeys: [], columns: [{ name: 'id' }], uniques: [{ columns: ['id'] }] },
	];

	expect(relationsToTypeScript(schema, 'camel', './schema.js').file).toContain(
		'import * as schema from "./schema.js";',
	);
	expect(relationsToTypeScript(schema, 'camel').file).toContain('import * as schema from "./schema";');
});

// The generated pair must type-check under `moduleResolution: nodenext` in an
// ES module project, which is what a NodeNext project does with them (#6628).
// The kit's own tree is CommonJS, so the pair lives in a temp folder under it:
// its package.json makes the files ES modules while `drizzle-orm` still
// resolves through the kit's node_modules.
test('an ES module project type-checks the generated relations under nodenext', async () => {
	const out = join(process.cwd(), 'tests', 'other', 'tmp', 'relations-import-esm');
	rmSync(out, { recursive: true, force: true });
	pkg(out, 'module');
	writeFileSync(
		join(out, 'schema.ts'),
		'import { integer, pgTable } from "drizzle-orm/pg-core";\n\nexport const users = pgTable("users", { id: integer().primaryKey() });\n',
	);
	const schema: SchemaForPull = [
		{ schema: 'public', foreignKeys: [], columns: [{ name: 'id' }], uniques: [{ columns: ['id'] }] },
	];

	try {
		await expect(tsc(relationsToTypeScript(schema, 'camel').file, join(out, 'relations.ts'))).rejects.toThrow(
			/TS2835|TS2307/,
		);
		await tsc(relationsToTypeScript(schema, 'camel', schemaImportFor(out)).file, join(out, 'relations.ts'));
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
