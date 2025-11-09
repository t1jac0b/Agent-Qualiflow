import test from "node:test";
import assert from "node:assert/strict";

import { finalizeBauBeschrieb } from "../src/agent/bauBeschrieb/processBauBeschrieb.js";
import { DatabaseTool } from "../src/tools/DatabaseTool.js";

function createExtracted({ projektleiter }) {
  return {
    kunde: {
      name: "ImmoVision AG",
      adresse: "Postgasse 3",
      plz: "3011",
      ort: "Bern",
    },
    objekt: {
      bezeichnung: "Neubau Wohn- und Geschäftshaus",
      adresse: "Seeweg 10-14",
      plz: "3013",
      ort: "Bern",
      notiz: null,
      erstellungsjahr: 2026,
    },
    objekttyp: "Mehrfamilienhaus Einfach",
    projektleiter,
    pendingFields: [],
  };
}

test("finalizeBauBeschrieb persists projektleiter and links objekt", async () => {
  const originalEnsureProjektleiter = DatabaseTool.ensureProjektleiter;
  const originalEnsureKunde = DatabaseTool.ensureKunde;
  const originalEnsureObjekttyp = DatabaseTool.ensureObjekttyp;
  const originalCreateObjektForKunde = DatabaseTool.createObjektForKunde;

  const projektleiterStub = { id: 42, name: "Marius Projektim" };
  const kundeStub = { id: 1, projektleiterId: 42, name: "ImmoVision AG" };
  const objekttypStub = { id: 2, bezeichnung: "Mehrfamilienhaus Einfach" };
  const objektStub = { id: 3, bezeichnung: "Neubau Wohn- und Geschäftshaus" };
  let capturedObjektInput = null;

  DatabaseTool.ensureProjektleiter = async ({ name }) => {
    assert.equal(name, projektleiterStub.name);
    return projektleiterStub;
  };
  DatabaseTool.ensureKunde = async () => kundeStub;
  DatabaseTool.ensureObjekttyp = async () => objekttypStub;
  DatabaseTool.createObjektForKunde = async (input) => {
    capturedObjektInput = input;
    return objektStub;
  };

  try {
    const result = await finalizeBauBeschrieb({
      ingestion: { storedPath: "storage/uploads/mock.pdf" },
      extracted: createExtracted({ projektleiter: projektleiterStub.name }),
      overrides: {},
    });

    assert.equal(result.status, "created");
    assert.deepEqual(result.projektleiter, projektleiterStub);
    assert.ok(capturedObjektInput, "Objekt wurde nicht angelegt");
    assert.equal(capturedObjektInput.projektleiterId, projektleiterStub.id);
  } finally {
    DatabaseTool.ensureProjektleiter = originalEnsureProjektleiter;
    DatabaseTool.ensureKunde = originalEnsureKunde;
    DatabaseTool.ensureObjekttyp = originalEnsureObjekttyp;
    DatabaseTool.createObjektForKunde = originalCreateObjektForKunde;
  }
});
