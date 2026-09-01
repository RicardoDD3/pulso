import {
  classifyRun,
  personalHrMax,
  peakZoneLabel,
  intensityCuts,
  INTENSITY_LABEL,
  type RunIntensity,
} from "@/lib/training/run-intensity";

/**
 * 2026-07-21: los chats no podían decir si una carrera fue HIIT o zona 2.
 * classifyRun etiqueta cada carrera Garmin por FC con señales en cascada:
 * spread de intervalos → zonas del plan → % del máx personal → absolutos.
 */

describe("personalHrMax", () => {
  it("devuelve el máximo max_hr observado", () => {
    expect(personalHrMax([{ max_hr: 172 }, { max_hr: 190 }, { max_hr: null }])).toBe(190);
  });

  it("devuelve null sin datos o con máximos no fisiológicos (<120)", () => {
    expect(personalHrMax([])).toBeNull();
    expect(personalHrMax([{ max_hr: null }])).toBeNull();
    expect(personalHrMax([{ max_hr: 95 }])).toBeNull();
  });
});

describe("classifyRun — firma de intervalos (spread de FC)", () => {
  it("spread ≥28 con pico ≥90% del máx personal → hiit", () => {
    // avg 150, max 185, personal 190: spread 35, pico 97%
    expect(classifyRun({ avg_hr: 150, max_hr: 185 }, { hrMaxPersonal: 190 })).toBe("hiit");
  });

  it("spread grande pero pico <90% del máx personal NO es hiit (fondo con colinas)", () => {
    // avg 140, max 170, personal 190: spread 30 pero pico 89.5% → cae a % → z2
    expect(classifyRun({ avg_hr: 140, max_hr: 170 }, { hrMaxPersonal: 190 })).toBe("z2");
  });

  it("spread ≥28 sin ninguna referencia de máx → hiit", () => {
    expect(classifyRun({ avg_hr: 120, max_hr: 155 }, {})).toBe("hiit");
  });
});

describe("classifyRun — zonas del plan activo", () => {
  const zones = [
    { zone: "Z1", bpm_range: [100, 130] as [number, number] },
    { zone: "Z2", bpm_range: [131, 145] as [number, number] },
    { zone: "Z3", bpm_range: [146, 160] as [number, number] },
    { zone: "Z4", bpm_range: [161, 175] as [number, number] },
    { zone: "Z5", bpm_range: [176, 190] as [number, number] },
  ];

  it("avg en Z1 o Z2 → z2", () => {
    expect(classifyRun({ avg_hr: 120, max_hr: 135 }, { zones })).toBe("z2");
    expect(classifyRun({ avg_hr: 140, max_hr: 150 }, { zones })).toBe("z2");
  });

  it("avg en Z3 → tempo", () => {
    expect(classifyRun({ avg_hr: 150, max_hr: 162 }, { zones })).toBe("tempo");
  });

  it("avg en Z4/Z5 → hiit", () => {
    expect(classifyRun({ avg_hr: 165, max_hr: 178 }, { zones })).toBe("hiit");
    expect(classifyRun({ avg_hr: 180, max_hr: 190 }, { zones })).toBe("hiit");
  });

  it("avg por encima de todas las zonas → hiit; por debajo → z2", () => {
    expect(classifyRun({ avg_hr: 195, max_hr: 200 }, { zones })).toBe("hiit");
    expect(classifyRun({ avg_hr: 90, max_hr: 100 }, { zones })).toBe("z2");
  });

  it("las zonas del plan ganan sobre el % del máx personal", () => {
    // avg 150: por zonas es Z3 (tempo); por % de 210 sería 71% (z2)
    expect(classifyRun({ avg_hr: 150, max_hr: 160 }, { zones, hrMaxPersonal: 210 })).toBe("tempo");
  });
});

describe("classifyRun — % del máx personal (sin zonas)", () => {
  const ctx = { hrMaxPersonal: 190 };

  it("≤78% → z2", () => {
    expect(classifyRun({ avg_hr: 140, max_hr: 150 }, ctx)).toBe("z2"); // 73.7%
  });

  it("entre 78% y 87% → tempo", () => {
    expect(classifyRun({ avg_hr: 160, max_hr: 170 }, ctx)).toBe("tempo"); // 84.2%
  });

  it(">87% → hiit", () => {
    expect(classifyRun({ avg_hr: 172, max_hr: 180 }, ctx)).toBe("hiit"); // 90.5%
  });
});

describe("classifyRun — cortes absolutos (último recurso)", () => {
  it("sin zonas ni máx personal usa 145/165 bpm", () => {
    expect(classifyRun({ avg_hr: 140, max_hr: null }, {})).toBe("z2");
    expect(classifyRun({ avg_hr: 150, max_hr: null }, {})).toBe("tempo");
    expect(classifyRun({ avg_hr: 170, max_hr: null }, {})).toBe("hiit");
  });
});

describe("classifyRun — sin datos de FC", () => {
  it("sin avg_hr → sin_fc aunque haya contexto", () => {
    expect(classifyRun({ avg_hr: null, max_hr: 180 }, { hrMaxPersonal: 190 })).toBe("sin_fc");
    expect(classifyRun({}, {})).toBe("sin_fc");
  });
});

/**
 * 2026-07-21 (parte 3): el coach negaba tener acceso a los picos. peakZoneLabel
 * califica el pico REAL de FC de una carrera (max_hr del reloj) contra las
 * zonas del plan o el máx personal; intensityCuts da los umbrales en bpm para
 * los minutos-sobre-umbral de la curva intradía.
 */
describe("peakZoneLabel", () => {
  const zones = [
    { zone: "Z1", bpm_range: [100, 130] as [number, number] },
    { zone: "Z2", bpm_range: [131, 145] as [number, number] },
    { zone: "Z3", bpm_range: [146, 160] as [number, number] },
    { zone: "Z4", bpm_range: [161, 175] as [number, number] },
    { zone: "Z5", bpm_range: [176, 190] as [number, number] },
  ];

  it("con zonas del plan devuelve la zona que alcanza el pico", () => {
    expect(peakZoneLabel(168, { zones })).toBe("Z4");
    expect(peakZoneLabel(185, { zones })).toBe("Z5");
    expect(peakZoneLabel(195, { zones })).toBe("Z5"); // por encima de todas
  });

  it("sin zonas devuelve el % del máx personal de 90 días", () => {
    expect(peakZoneLabel(168, { hrMaxPersonal: 180 })).toBe("93% de su máx 90d");
  });

  it("devuelve null sin pico o sin ninguna referencia", () => {
    expect(peakZoneLabel(null, { zones })).toBeNull();
    expect(peakZoneLabel(0, { zones })).toBeNull();
    expect(peakZoneLabel(168, {})).toBeNull();
  });
});

describe("intensityCuts", () => {
  const zones = [
    { zone: "Z2", bpm_range: [131, 145] as [number, number] },
    { zone: "Z4", bpm_range: [161, 175] as [number, number] },
  ];

  it("con zonas: techo de Z2 y piso de Z4", () => {
    expect(intensityCuts({ zones })).toEqual({ easyMaxBpm: 145, qualityMinBpm: 161 });
  });

  it("sin zonas: 78% y 87% del máx personal", () => {
    expect(intensityCuts({ hrMaxPersonal: 190 })).toEqual({ easyMaxBpm: 148, qualityMinBpm: 165 });
  });

  it("zonas sin Z4 dejan el corte de calidad en null", () => {
    expect(intensityCuts({ zones: [{ zone: "Z2", bpm_range: [131, 145] }] })).toEqual({
      easyMaxBpm: 145,
      qualityMinBpm: null,
    });
  });

  it("sin ninguna referencia: ambos null", () => {
    expect(intensityCuts({})).toEqual({ easyMaxBpm: null, qualityMinBpm: null });
  });
});

describe("INTENSITY_LABEL", () => {
  it("mapea cada intensidad a su etiqueta de prompt", () => {
    const expected: Record<RunIntensity, string> = {
      hiit: "HIIT",
      tempo: "tempo",
      z2: "Z2",
      sin_fc: "s/FC",
    };
    expect(INTENSITY_LABEL).toEqual(expected);
  });
});
