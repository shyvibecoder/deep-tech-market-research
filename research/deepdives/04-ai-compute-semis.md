# AI Compute, Semiconductors & Datacenter Networking — Deep Dive (Wave 1)

**Core thesis:** Compute scarcity has already migrated once — GPUs (logic wafers) → HBM + CoWoS advanced packaging → now into power. Next under-priced migrations: (1) HBM/TSV capacity + DRAM-wafer opportunity cost, (2) 3D hybrid bonding (SoIC) + silicon→glass interposer transition, (3) specialty materials (ABF substrate, T-glass, EUV photoresist, e-gases), (4) optical interconnect / co-packaged optics, (5) power electronics (SiC/GaN) for 800V HVDC. Skeptic flag: a 2027–2028 AI-capex digestion air-pocket could un-bind several simultaneously.

## Scarcity migration timeline
- 2023–25: logic wafers + CoWoS (the "has been")
- 2026: CoWoS + HBM/TSV + ABF/T-glass/resist spikes (binding now)
- 2027: power (800V/SiC-GaN, Kyber) + SoIC ramp begins + DDR5 spillover
- 2028–29: 3D hybrid bonding capital ceiling, silicon→glass/panel interposer, HBM5/custom base die
- 2028–30: optical/CPO scale-up as copper hits the wall
- Overarching risk: 2027–2028 capex-digestion air-pocket un-binds the chain

## Structural scarcities
- **S1 Leading-edge logic wafers (N2/A16)** — partially bound, old puck. Binds 2025–27, eases into 2028. Moat: TSMC near-monopoly, $20B+/fab. Expressions: TSM, ASML, AMAT/LRCX/KLAC.
- **S2 Advanced packaging (CoWoS + SoIC hybrid bonding)** — binding now (current puck). CoWoS tight thru 2026, eases 2027; SoIC binds 2027–29 ($7B/10k wafers throttles ramp); glass/panel (CoPoS) 2028–29. Expressions: TSMC, BESI (purest hybrid-bonding), ASE/Amkor, AMAT/TEL, SCHMID.
- **S3 HBM + TSV capacity** ⭐ — binding now, hidden DRAM-wafer opportunity cost (HBM ~3× wafer/GB vs DDR5; >70% of TSV capacity to HBM → DDR5/memory squeeze thru 2027). Oligopoly SK Hynix>Samsung>Micron. Expressions: SK Hynix (035420.KS), Micron (MU, best US-listed), Samsung.
- **S4 Power electronics SiC/GaN + 800V HVDC** — binds 2027 (NVIDIA Kyber). Expressions: Navitas (NVTS), Infineon (IFX), Vertiv (VRT), MPWR, onsemi.
- **S5 Optical interconnect / CPO** ⭐ — binds 2027–30 as copper hits reach/power wall; >35% penetration by 2030; NVIDIA $4B pre-commit (Coherent+Lumentum). Expressions: COHR, LITE, AVGO, FN, TSMC (COUPE).
- **S6 Specialty materials & consumables** ⭐ (most under-priced) — ABF film (Ajinomoto monopoly), T-glass cloth (peaks 2026), EUV photoresist (~6mo inventory, naphtha/Hormuz exposed). Intermittent, geopolitically fragile. Expressions: Ajinomoto, Ibiden, Shinko, AT&S, Shin-Etsu, JSR, TOK.
- **S7 Cooling/metrology/skilled packaging labor** — rising, services-side. Vertiv (VRT), KLA (KLAC).

## Non-consensus
1. DRAM wafer opportunity cost from HBM → broad memory squeeze (highest-conviction non-consensus)
2. Silicon→glass/panel interposer transition ~2028 (SCHMID, Absolics/SKC, Corning)
3. ABF + T-glass + EUV photoresist single-source fragility (spikes 2026–27)
4. SoIC capital intensity as throughput governor (2027–29)
5. Optical lasers/EML + fiber-attach scale-up bottleneck (2028–30)
6. SiC/GaN for 800V HVDC (Kyber 2027)
7. Packaging metrology + skilled labor ceiling

## Confidence
Sequence: HIGH. Absolute dates: MEDIUM (6–18mo slips normal). Dominant macro risk: AI capex digestion — hyperscaler capex ~$256B (2024) → ~$443B (2025) → ~$600–700B (2026); first GPU-backed debt maturities 2026–27; air-pocket most likely 2027–2028 could simultaneously un-bind CoWoS, HBM, substrates.
