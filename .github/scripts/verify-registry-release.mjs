#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Post-publish truth check for the delegated Registry flow. The release
// service currently ends successful publishes in RELEASE_CONFLICT
// (emdash-cms/emdash#4159): the intent writes the release record, then
// reconciliation judges that same record a conflict, failing the job.
// This verifier asks the publisher PDS directly whether the record for
// the selector version exists and carries exactly the bundle bytes
// this job prepared (same multihash checksum the Registry records).
// The publish step stays fail-closed: the job only passes when the
// Registry record matches, whatever the intent reported.
const RELEASE_COLLECTION = "com.emdashcms.experimental.package.release";
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function computePackageChecksum(bytes) {
	const digest = createHash("sha256").update(bytes).digest();
	const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of multihash) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return `b${out}`;
}

export function parseSelector(selector) {
	const at = selector?.lastIndexOf("@") ?? -1;
	if (at <= 0 || at === selector.length - 1) return null;
	return { slug: selector.slice(0, at), version: selector.slice(at + 1) };
}

export function recordMatches(value, expected) {
	const reasons = [];
	if (!value || typeof value !== "object") return { ok: false, reasons: ["record is not an object"] };
	if (value.package !== expected.slug) reasons.push(`package is ${JSON.stringify(value.package)}`);
	if (value.version !== expected.version) reasons.push(`version is ${JSON.stringify(value.version)}`);
	const artifact = value.artifacts?.package;
	if (!artifact || typeof artifact !== "object") {
		reasons.push("artifacts.package is missing");
	} else {
		if (artifact.checksum !== expected.checksum) reasons.push("package checksum differs");
		if (artifact.blob?.size !== expected.size) reasons.push("package blob size differs");
		if (artifact.blob?.mimeType !== "application/gzip") reasons.push("package blob is not gzip");
	}
	return { ok: reasons.length === 0, reasons };
}

// A retry on a version tag whose release is already listed cannot compare a
// rebuild (a fresh build has not matched the published bytes). It checks the
// record names this repository's release workflow at this tag, downloads the
// published archive, and checks it against the record's own checksum; the
// workflow then verifies that archive's signed GitHub build attestation.
export function listedRecordMatches(value, expected) {
	const reasons = [];
	if (!value || typeof value !== "object") return { ok: false, reasons: ["record is not an object"] };
	if (value.package !== expected.slug) reasons.push(`package is ${JSON.stringify(value.package)}`);
	if (value.version !== expected.version) reasons.push(`version is ${JSON.stringify(value.version)}`);
	const artifact = value.artifacts?.package;
	if (!artifact?.checksum || artifact.blob?.mimeType !== "application/gzip") reasons.push("package artifact is missing or not gzip");
	const provenance = value.extensions?.["com.emdashcms.experimental.package.releaseExtension"]?.provenance;
	if (provenance?.builderId !== expected.builder) reasons.push(`provenance builder is ${JSON.stringify(provenance?.builderId)}`);
	return { ok: reasons.length === 0, reasons };
}

export async function resolvePdsEndpoint(publisherDid, fetchImpl = fetch) {
	const url = publisherDid.startsWith("did:plc:")
		? `https://plc.directory/${publisherDid}`
		: publisherDid.startsWith("did:web:")
			? `https://${publisherDid.slice("did:web:".length).split(":").join("/")}/.well-known/did.json`
			: null;
	if (!url) throw new Error(`unsupported publisher DID method: ${publisherDid}`);
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`DID resolution failed with HTTP ${response.status}`);
	const document = await response.json();
	const service = document?.service?.find((entry) =>
		entry?.id === "#atproto_pds" || entry?.id === `${publisherDid}#atproto_pds`,
	);
	if (!service?.serviceEndpoint) throw new Error("publisher DID has no #atproto_pds service");
	return service.serviceEndpoint;
}

async function fetchReleaseRecord(pds, publisherDid, slug, version, fetchImpl) {
	const url = new URL(`${pds.replace(/\/$/, "")}/xrpc/com.atproto.repo.getRecord`);
	url.searchParams.set("repo", publisherDid);
	url.searchParams.set("collection", RELEASE_COLLECTION);
	url.searchParams.set("rkey", `${slug}:${version}`);
	const response = await fetchImpl(url);
	if (response.status === 400) {
		const body = await response.json().catch(() => null);
		if (body?.error === "RecordNotFound") return null;
	}
	if (!response.ok) throw new Error(`getRecord failed with HTTP ${response.status}`);
	const record = await response.json();
	const expectedUri = `at://${publisherDid}/${RELEASE_COLLECTION}/${slug}:${version}`;
	if (record?.uri !== expectedUri) throw new Error("getRecord returned an unexpected record URI");
	return record;
}

/** The archive the record points at, byte for byte: its checksum and size. */
export function publishedArtifactMatches(value, bytes) {
	const artifact = value?.artifacts?.package;
	const reasons = [];
	if (computePackageChecksum(bytes) !== artifact?.checksum) reasons.push("published archive checksum differs from its record");
	if (bytes.byteLength !== artifact?.blob?.size) reasons.push("published archive size differs from its record");
	return { ok: reasons.length === 0, reasons };
}

async function fetchPublishedArtifact(pds, publisherDid, value, fetchImpl) {
	const cid = value?.artifacts?.package?.blob?.ref?.$link;
	if (typeof cid !== "string" || !cid) throw new Error("record has no package blob");
	const url = new URL(`${pds.replace(/\/$/, "")}/xrpc/com.atproto.sync.getBlob`);
	url.searchParams.set("did", publisherDid);
	url.searchParams.set("cid", cid);
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`getBlob failed with HTTP ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [publisherDid, selector, bundleFile, builder, publishedFile] = process.argv.slice(2);
	const parsed = parseSelector(selector);
	const listed = bundleFile === "--listed";
	if (!publisherDid || !parsed || !bundleFile || (listed && (!builder || !publishedFile))) {
		console.error("usage: verify-registry-release.mjs <publisher-did> <slug@version> <bundle-file | --listed <builder-id> <published-file>>");
		process.exit(2);
	}
	const bytes = listed ? null : await readFile(bundleFile);
	const expected = listed
		? { slug: parsed.slug, version: parsed.version, builder }
		: { slug: parsed.slug, version: parsed.version, checksum: computePackageChecksum(bytes), size: bytes.byteLength };
	const matches = listed ? listedRecordMatches : recordMatches;
	const pds = await resolvePdsEndpoint(publisherDid);
	const deadline = Date.now() + 5 * 60_000;
	for (;;) {
		const record = await fetchReleaseRecord(pds, publisherDid, parsed.slug, parsed.version, fetch);
		if (record) {
			let result = matches(record.value, expected);
			if (result.ok && listed) {
				const published = await fetchPublishedArtifact(pds, publisherDid, record.value, fetch);
				result = publishedArtifactMatches(record.value, published);
				if (result.ok) await writeFile(publishedFile, published);
			}
			if (result.ok) {
				console.log(
					`registry_release_verified=${parsed.slug}@${parsed.version} uri=${record.uri} cid=${record.cid} ${listed ? `builder=${builder}` : `checksum=${expected.checksum}`}`,
				);
				break;
			}
			console.error(
				`::error::Registry record for ${parsed.slug}@${parsed.version} does not match ${listed ? "this tag's release" : "the prepared bundle"}: ${result.reasons.join("; ")}`,
			);
			process.exit(1);
		}
		if (Date.now() >= deadline) {
			console.error(
				`::error::Registry record for ${parsed.slug}@${parsed.version} did not appear within 5 minutes`,
			);
			process.exit(1);
		}
		await new Promise((resolve) => setTimeout(resolve, 15_000));
	}
}
