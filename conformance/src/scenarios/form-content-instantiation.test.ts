/**
 * form-content-instantiation — RFC 0137 `form-content-packs.md` §"Instantiation",
 * §"No submission routing" (F2).
 *
 * **This is the behavioral half of RFC 0137, and it exists because the other half
 * could not witness anything.** `form-content-packs.test.ts` is entirely
 * server-free: it proves the corpus agrees with itself — the schema carries the
 * kind, the `anyOf` branch is present, the two field-type vocabularies are
 * byte-identical. Every one of those legs passes identically against a host that
 * never implemented RFC 0137, including one that advertises
 * `host.forms.contentPacks` and does nothing. Running that suite with
 * `--base-url` and calling the green a witness would be vacuous. This file is
 * what `OPENWOP_REQUIRE_BEHAVIOR=true` is supposed to make non-vacuous.
 *
 * Gated on the `host.forms.contentPacks` advertisement AND the host-sample
 * instantiate seam; soft-skips when either is absent, so a host that does not
 * implement RFC 0137 skips cleanly and stays v1-compliant.
 *
 * What is asserted over the wire (each maps to a numbered §Instantiation rule):
 *
 *   #1 — instantiation goes through the host's NORMAL create path, and the
 *        resulting form carries no routing destination (§F2: a pack MUST NOT
 *        bind where submissions go; the operator configures that afterward).
 *   #2 — an unrecognized `vendor.*` / `x-` field type DEGRADES to a plain text
 *        input rather than failing the instantiation. This is the leg that
 *        matters most: refuse-everything is a natural implementation instinct
 *        and it is non-conformant here.
 *   #3 — pack-authored fields are FULLY EDITABLE, with no privilege over a
 *        hand-added field.
 *
 * F1 (the trust boundary) is deliberately NOT asserted here. Its observable —
 * a `contentTrust` tag on a composed prompt — is not visible to a black-box
 * client for a kind that composes no prompt of its own. Claiming to witness it
 * over HTTP would be the same vacuity this file exists to avoid; it stays a
 * host-side guarantee backed by the schema/corpus legs and the host's own tests.
 *
 * @see spec/v1/form-content-packs.md §"Instantiation", §"No submission routing"
 * @see spec/v1/host-capabilities.md §host.forms
 * @see RFCS/0137-form-content-packs.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import {
  readFormContentCap,
  formContentSupported,
  instantiateTemplate,
  fieldById,
  isEditable,
  PLAIN_TEXT_CONTROLS,
} from '../lib/formContentPacks.js';

/**
 * Conformance fixture templates a host wires the seam against.
 * `…form.basic` uses only portable-subset types; `…form.extended` additionally
 * declares one `vendor.*` field the host is not expected to recognize.
 */
const BASIC_TEMPLATE = 'vendor.conformance.form.basic';
const EXTENDED_TEMPLATE = 'vendor.conformance.form.extended';
const VENDOR_FIELD_ID = 'vendorExtended';

describe('form-content-instantiation: a host instantiates a registered template (RFC 0137 §Instantiation)', () => {
  it('#1 instantiation goes through the host NORMAL create path', async () => {
    if (!formContentSupported(await readFormContentCap())) return; // unadvertised — soft-skip
    const res = await instantiateTemplate(BASIC_TEMPLATE);
    if (res === null) return; // seam absent — soft-skip

    expect(
      res.status >= 200 && res.status < 300,
      driver.describe('form-content-packs.md §Instantiation', 'a registered template MUST instantiate'),
    ).toBe(true);

    if (res.json['viaCreatePath'] !== undefined) {
      expect(
        res.json['viaCreatePath'],
        driver.describe(
          'form-content-packs.md §Instantiation #1',
          'the host MUST create the form through the SAME path that serves a hand-authored form',
        ),
      ).toBe(true);
    }

    expect(
      res.fields.length,
      driver.describe('form-content-packs.md §Instantiation', 'the instantiated form MUST carry the template fields'),
    ).toBeGreaterThan(0);
  });

  it('#1/F2 the instantiated form carries NO pack-bound submission destination', async () => {
    if (!formContentSupported(await readFormContentCap())) return;
    const res = await instantiateTemplate(BASIC_TEMPLATE);
    if (res === null) return;

    const routing = res.json['routing'];
    const bound =
      routing !== undefined &&
      routing !== null &&
      !(typeof routing === 'object' && Object.keys(routing as Record<string, unknown>).length === 0);

    expect(
      bound,
      driver.describe(
        'form-content-packs.md §No submission routing (F2)',
        'a template MUST NOT bind a submission destination — the operator configures routing afterward, as for any hand-authored form',
      ),
    ).toBe(false);
  });

  it('#2 an unrecognized vendor.* field type DEGRADES to plain text, and does NOT fail the instantiation', async () => {
    if (!formContentSupported(await readFormContentCap())) return;
    const res = await instantiateTemplate(EXTENDED_TEMPLATE);
    if (res === null) return;

    expect(
      res.status >= 200 && res.status < 300 && res.json['refused'] !== true,
      driver.describe(
        'form-content-packs.md §Instantiation #2',
        'a well-formed but unrecognized vendor.*/x- type MUST degrade, NOT fail the instantiation — refusing a valid extension breaks forward compatibility',
      ),
    ).toBe(true);

    const field = fieldById(res.fields, VENDOR_FIELD_ID);
    if (field === undefined) return; // host doesn't report per-field controls on the seam — soft-skip
    expect(
      field.control !== undefined && PLAIN_TEXT_CONTROLS.has(field.control),
      driver.describe(
        'form-content-packs.md §Instantiation #2',
        `an unrecognized field type MUST render as a plain text input (got control ${JSON.stringify(field.control)})`,
      ),
    ).toBe(true);
  });

  it('#3 pack-authored fields are FULLY EDITABLE — no privilege over a hand-added field', async () => {
    if (!formContentSupported(await readFormContentCap())) return;
    const res = await instantiateTemplate(BASIC_TEMPLATE);
    if (res === null) return;

    const reporting = res.fields.filter((f) => f.editable !== undefined || f.locked !== undefined);
    if (reporting.length === 0) return; // host doesn't report editability — soft-skip

    expect(
      reporting.every((f) => isEditable(f)),
      driver.describe(
        'form-content-packs.md §Instantiation #3',
        'the host MUST NOT treat a pack-authored field as immutable or privileged relative to a hand-added one',
      ),
    ).toBe(true);
  });
});
