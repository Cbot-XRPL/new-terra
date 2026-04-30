/**
 * Catalog seed — production-grade starter list of materials + labor lines
 * for residential construction work in the Atlanta GA metro, priced for
 * mid-2026.
 *
 * Usage: `npm --workspace server run db:seed:catalog`
 *
 * Idempotent: keyed off (name + unit) so re-running won't duplicate. If a
 * row already exists the price is left alone — that lets you tweak a price
 * in the UI without it getting clobbered on the next reseed. Delete the row
 * (or rename it) and re-run if you want the seed default back.
 *
 * Prices are reasonable Atlanta retail (Home Depot Pro / 84 Lumber / ABC
 * Supply walk-in pricing for a small contractor with no volume discount).
 * Treat them as a starting bid — review each project before quoting.
 */

// Side-effect import — triggers our env walker so DATABASE_URL is loaded
// from the repo-root .env before PrismaClient instantiates. Without this
// the script fails with "Environment variable not found: DATABASE_URL"
// because Prisma's own dotenv only looks in cwd and cwd/prisma.
import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedItem {
  name: string;
  // 'material' | 'labor' | 'subcontract' | 'fee' — drives Labor vs Materials
  // bucket on estimate/budget conversion.
  kind: string;
  unit: string;
  // dollars; converted to cents on insert so the seed file stays readable.
  price: number;
  category: string;
  notes?: string;
}

const ITEMS: SeedItem[] = [
  // ─── Framing / Lumber ────────────────────────────────────────────────
  { name: '2x4 x 8ft SPF stud',                     kind: 'material', unit: 'ea',   price: 4.20,  category: 'Framing' },
  { name: '2x4 x 10ft SPF',                         kind: 'material', unit: 'ea',   price: 7.40,  category: 'Framing' },
  { name: '2x4 x 12ft SPF',                         kind: 'material', unit: 'ea',   price: 9.20,  category: 'Framing' },
  { name: '2x6 x 8ft SPF',                          kind: 'material', unit: 'ea',   price: 7.20,  category: 'Framing' },
  { name: '2x6 x 10ft SPF',                         kind: 'material', unit: 'ea',   price: 10.50, category: 'Framing' },
  { name: '2x6 x 12ft SPF',                         kind: 'material', unit: 'ea',   price: 13.40, category: 'Framing' },
  { name: '2x8 x 12ft SPF',                         kind: 'material', unit: 'ea',   price: 18.00, category: 'Framing' },
  { name: '2x10 x 12ft SPF',                        kind: 'material', unit: 'ea',   price: 24.00, category: 'Framing' },
  { name: '2x12 x 12ft SPF',                        kind: 'material', unit: 'ea',   price: 32.00, category: 'Framing' },
  { name: '4x4 x 8ft pressure-treated',             kind: 'material', unit: 'ea',   price: 13.50, category: 'Framing' },
  { name: '4x4 x 10ft pressure-treated',            kind: 'material', unit: 'ea',   price: 18.00, category: 'Framing' },
  { name: '6x6 x 8ft pressure-treated',             kind: 'material', unit: 'ea',   price: 30.00, category: 'Framing' },
  { name: '1/2" CDX plywood 4x8',                   kind: 'material', unit: 'sheet', price: 42.00, category: 'Framing' },
  { name: '5/8" T&G OSB subfloor 4x8',              kind: 'material', unit: 'sheet', price: 38.00, category: 'Framing' },
  { name: '7/16" OSB sheathing 4x8',                kind: 'material', unit: 'sheet', price: 25.00, category: 'Framing' },
  { name: 'LVL 1.75x9.5',                           kind: 'material', unit: 'lf',   price: 11.00, category: 'Framing' },
  { name: 'LVL 1.75x11.875',                        kind: 'material', unit: 'lf',   price: 14.00, category: 'Framing' },
  { name: 'LVL 1.75x14',                            kind: 'material', unit: 'lf',   price: 18.00, category: 'Framing' },
  { name: 'Joist hanger 2x8 (Simpson LUS28)',       kind: 'material', unit: 'ea',   price: 1.50,  category: 'Framing' },
  { name: 'Joist hanger 2x10 (Simpson LUS210)',     kind: 'material', unit: 'ea',   price: 2.00,  category: 'Framing' },
  { name: 'Hurricane tie H2.5A',                    kind: 'material', unit: 'ea',   price: 0.85,  category: 'Framing' },
  { name: 'Framing nails 16d (5lb box)',            kind: 'material', unit: 'box',  price: 25.00, category: 'Framing' },
  { name: 'Framing screws 3" (5lb box)',            kind: 'material', unit: 'box',  price: 35.00, category: 'Framing' },
  { name: 'Joist hanger nails 10d galv (1lb)',      kind: 'material', unit: 'box',  price: 9.00,  category: 'Framing' },

  // ─── Sitework / Excavation ───────────────────────────────────────────
  { name: 'Compacted gravel #57',                   kind: 'material', unit: 'cuyd', price: 35.00, category: 'Sitework' },
  { name: 'Crusher run',                            kind: 'material', unit: 'cuyd', price: 32.00, category: 'Sitework' },
  { name: 'Sand — masonry',                         kind: 'material', unit: 'cuyd', price: 25.00, category: 'Sitework' },
  { name: 'Topsoil',                                kind: 'material', unit: 'cuyd', price: 30.00, category: 'Sitework' },
  { name: 'Mini-excavator + operator',              kind: 'labor',    unit: 'day',  price: 850.00, category: 'Sitework' },
  { name: 'Skid-steer + operator',                  kind: 'labor',    unit: 'day',  price: 700.00, category: 'Sitework' },
  { name: 'Excavation labor',                       kind: 'labor',    unit: 'hr',   price: 50.00, category: 'Sitework' },

  // ─── Concrete / Foundation ───────────────────────────────────────────
  { name: 'Ready-mix concrete 3000psi',             kind: 'material', unit: 'cuyd', price: 145.00, category: 'Concrete' },
  { name: 'Ready-mix concrete 4000psi',             kind: 'material', unit: 'cuyd', price: 160.00, category: 'Concrete' },
  { name: 'Concrete mix 60lb bag',                  kind: 'material', unit: 'bag',  price: 7.00,   category: 'Concrete' },
  { name: 'Concrete mix 80lb bag',                  kind: 'material', unit: 'bag',  price: 9.00,   category: 'Concrete' },
  { name: '#4 rebar 20ft',                          kind: 'material', unit: 'ea',   price: 12.00,  category: 'Concrete' },
  { name: '#5 rebar 20ft',                          kind: 'material', unit: 'ea',   price: 18.00,  category: 'Concrete' },
  { name: 'Wire mesh 6x6 W1.4 5x10 sheet',          kind: 'material', unit: 'sheet', price: 14.00, category: 'Concrete' },
  { name: 'Vapor barrier 6mil 10x100',              kind: 'material', unit: 'roll', price: 85.00,  category: 'Concrete' },
  { name: 'Anchor bolt 1/2"x10" J',                 kind: 'material', unit: 'ea',   price: 4.00,   category: 'Concrete' },
  { name: 'Foundation drain 4" perforated 100ft',   kind: 'material', unit: 'roll', price: 52.00,  category: 'Concrete' },
  { name: 'Concrete finishing labor',               kind: 'labor',    unit: 'hr',   price: 60.00,  category: 'Concrete' },
  { name: 'Concrete pour labor',                    kind: 'labor',    unit: 'hr',   price: 50.00,  category: 'Concrete' },
  { name: 'Foundation forming labor',               kind: 'labor',    unit: 'hr',   price: 55.00,  category: 'Concrete' },

  // ─── Roofing ─────────────────────────────────────────────────────────
  { name: 'Architectural shingle 30-yr (per sq)',   kind: 'material', unit: 'sq',   price: 130.00, category: 'Roofing' },
  { name: 'Synthetic underlayment 10 sq',           kind: 'material', unit: 'roll', price: 145.00, category: 'Roofing' },
  { name: 'Felt 30# (4 sq)',                        kind: 'material', unit: 'roll', price: 40.00,  category: 'Roofing' },
  { name: 'Ice & water shield 200 sf',              kind: 'material', unit: 'roll', price: 90.00,  category: 'Roofing' },
  { name: 'Ridge vent 4ft',                         kind: 'material', unit: 'ea',   price: 18.00,  category: 'Roofing' },
  { name: 'Drip edge 10ft',                         kind: 'material', unit: 'ea',   price: 11.00,  category: 'Roofing' },
  { name: 'Roofing nails 1.25" coil',               kind: 'material', unit: 'box',  price: 50.00,  category: 'Roofing' },
  { name: 'Step flashing',                          kind: 'material', unit: 'ea',   price: 4.00,   category: 'Roofing' },
  { name: 'Pipe boot 1.5"–3"',                      kind: 'material', unit: 'ea',   price: 15.00,  category: 'Roofing' },
  { name: 'Soffit vent (intake)',                   kind: 'material', unit: 'ea',   price: 6.00,   category: 'Roofing' },
  { name: 'Roofing labor (install per sq)',         kind: 'labor',    unit: 'sq',   price: 200.00, category: 'Roofing' },
  { name: 'Tear-off labor (per sq, 1 layer)',       kind: 'labor',    unit: 'sq',   price: 90.00,  category: 'Roofing' },
  { name: 'Roofer hourly',                          kind: 'labor',    unit: 'hr',   price: 55.00,  category: 'Roofing' },

  // ─── Siding / Exterior ───────────────────────────────────────────────
  { name: 'Hardie plank lap 8.25" (per sf)',        kind: 'material', unit: 'sqft', price: 3.20,   category: 'Siding' },
  { name: 'Hardie trim 1x4 x 12ft',                 kind: 'material', unit: 'ea',   price: 25.00,  category: 'Siding' },
  { name: 'Hardie trim 1x6 x 12ft',                 kind: 'material', unit: 'ea',   price: 32.00,  category: 'Siding' },
  { name: 'Vinyl siding D4 (per sq)',               kind: 'material', unit: 'sq',   price: 115.00, category: 'Siding' },
  { name: 'LP SmartSide 16" lap x 12ft',            kind: 'material', unit: 'ea',   price: 52.00,  category: 'Siding' },
  { name: 'House wrap (Tyvek) 9x100',               kind: 'material', unit: 'roll', price: 230.00, category: 'Siding' },
  { name: 'Aluminum soffit panel',                  kind: 'material', unit: 'sqft', price: 4.00,   category: 'Siding' },
  { name: 'Fascia 1x6 PT 16ft',                     kind: 'material', unit: 'ea',   price: 18.00,  category: 'Siding' },
  { name: 'Color-matched caulk (Hardie)',           kind: 'material', unit: 'tube', price: 10.00,  category: 'Siding' },
  { name: 'Hardie install labor (per sf)',          kind: 'labor',    unit: 'sqft', price: 4.00,   category: 'Siding' },
  { name: 'Vinyl siding install labor (per sf)',    kind: 'labor',    unit: 'sqft', price: 2.50,   category: 'Siding' },
  { name: 'Wrap & flash labor',                     kind: 'labor',    unit: 'hr',   price: 50.00,  category: 'Siding' },

  // ─── Electrical ──────────────────────────────────────────────────────
  { name: '14/2 NM-B 250ft',                        kind: 'material', unit: 'roll', price: 115.00, category: 'Electrical' },
  { name: '12/2 NM-B 250ft',                        kind: 'material', unit: 'roll', price: 165.00, category: 'Electrical' },
  { name: '10/2 NM-B 250ft',                        kind: 'material', unit: 'roll', price: 260.00, category: 'Electrical' },
  { name: '6/3 NM-B 125ft',                         kind: 'material', unit: 'roll', price: 310.00, category: 'Electrical' },
  { name: '14/3 NM-B 250ft',                        kind: 'material', unit: 'roll', price: 185.00, category: 'Electrical' },
  { name: 'Single-pole 15A switch (Decora)',        kind: 'material', unit: 'ea',   price: 4.00,   category: 'Electrical' },
  { name: '3-way switch (Decora)',                  kind: 'material', unit: 'ea',   price: 7.00,   category: 'Electrical' },
  { name: 'Receptacle 15A duplex (Decora)',         kind: 'material', unit: 'ea',   price: 3.50,   category: 'Electrical' },
  { name: 'GFCI receptacle 20A',                    kind: 'material', unit: 'ea',   price: 20.00,  category: 'Electrical' },
  { name: 'AFCI receptacle 15A',                    kind: 'material', unit: 'ea',   price: 30.00,  category: 'Electrical' },
  { name: 'USB receptacle (Type-C)',                kind: 'material', unit: 'ea',   price: 25.00,  category: 'Electrical' },
  { name: 'Single-gang plastic box (new work)',     kind: 'material', unit: 'ea',   price: 0.80,   category: 'Electrical' },
  { name: '4" round pancake box (ceiling)',         kind: 'material', unit: 'ea',   price: 3.00,   category: 'Electrical' },
  { name: '200A main panel (Square D)',             kind: 'material', unit: 'ea',   price: 325.00, category: 'Electrical' },
  { name: '100A subpanel',                          kind: 'material', unit: 'ea',   price: 185.00, category: 'Electrical' },
  { name: '15A breaker (single-pole)',              kind: 'material', unit: 'ea',   price: 9.00,   category: 'Electrical' },
  { name: '20A breaker (single-pole)',              kind: 'material', unit: 'ea',   price: 11.00,  category: 'Electrical' },
  { name: '30A double-pole breaker',                kind: 'material', unit: 'ea',   price: 30.00,  category: 'Electrical' },
  { name: '50A double-pole breaker',                kind: 'material', unit: 'ea',   price: 35.00,  category: 'Electrical' },
  { name: 'AFCI breaker 20A',                       kind: 'material', unit: 'ea',   price: 50.00,  category: 'Electrical' },
  { name: 'LED recessed 6"',                        kind: 'material', unit: 'ea',   price: 20.00,  category: 'Electrical' },
  { name: 'LED bulb A19 60W eq',                    kind: 'material', unit: 'ea',   price: 3.00,   category: 'Electrical' },
  { name: 'Smoke detector (hardwired w/ battery)',  kind: 'material', unit: 'ea',   price: 25.00,  category: 'Electrical' },
  { name: 'CO detector (hardwired)',                kind: 'material', unit: 'ea',   price: 30.00,  category: 'Electrical' },
  { name: 'Romex staples (250ct)',                  kind: 'material', unit: 'box',  price: 5.00,   category: 'Electrical' },
  { name: 'Wire nut assortment',                    kind: 'material', unit: 'box',  price: 12.00,  category: 'Electrical' },
  { name: 'Master electrician',                     kind: 'labor',    unit: 'hr',   price: 120.00, category: 'Electrical' },
  { name: 'Journeyman electrician',                 kind: 'labor',    unit: 'hr',   price: 95.00,  category: 'Electrical' },
  { name: 'Apprentice electrician',                 kind: 'labor',    unit: 'hr',   price: 55.00,  category: 'Electrical' },
  { name: 'Electrical rough-in (per opening)',      kind: 'labor',    unit: 'ea',   price: 90.00,  category: 'Electrical', notes: 'Per box: switch, receptacle, or fixture rough-in.' },
  { name: 'Service upgrade 200A (lump)',            kind: 'subcontract', unit: 'lump', price: 2800.00, category: 'Electrical' },

  // ─── Plumbing ────────────────────────────────────────────────────────
  { name: '1/2" PEX 100ft',                         kind: 'material', unit: 'roll', price: 55.00,  category: 'Plumbing' },
  { name: '3/4" PEX 100ft',                         kind: 'material', unit: 'roll', price: 80.00,  category: 'Plumbing' },
  { name: '1" PEX 100ft',                           kind: 'material', unit: 'roll', price: 110.00, category: 'Plumbing' },
  { name: 'PEX crimp ring 1/2" (50ct)',             kind: 'material', unit: 'box',  price: 14.00,  category: 'Plumbing' },
  { name: 'PEX 1/2" elbow',                         kind: 'material', unit: 'ea',   price: 1.20,   category: 'Plumbing' },
  { name: 'PEX 1/2" tee',                           kind: 'material', unit: 'ea',   price: 1.50,   category: 'Plumbing' },
  { name: 'PVC 3" SCH40 10ft',                      kind: 'material', unit: 'ea',   price: 14.00,  category: 'Plumbing' },
  { name: 'PVC 4" SCH40 10ft',                      kind: 'material', unit: 'ea',   price: 22.00,  category: 'Plumbing' },
  { name: 'PVC 3" elbow',                           kind: 'material', unit: 'ea',   price: 5.00,   category: 'Plumbing' },
  { name: 'ABS 1.5" 10ft',                          kind: 'material', unit: 'ea',   price: 11.00,  category: 'Plumbing' },
  { name: 'Copper 1/2" type-L 10ft',                kind: 'material', unit: 'ea',   price: 26.00,  category: 'Plumbing' },
  { name: 'Shutoff valve 1/2" (1/4-turn)',          kind: 'material', unit: 'ea',   price: 5.00,   category: 'Plumbing' },
  { name: 'Toilet (round bowl, builder grade)',     kind: 'material', unit: 'ea',   price: 190.00, category: 'Plumbing' },
  { name: 'Toilet (elongated, mid-grade)',          kind: 'material', unit: 'ea',   price: 250.00, category: 'Plumbing' },
  { name: 'Lavatory faucet (mid-grade)',            kind: 'material', unit: 'ea',   price: 130.00, category: 'Plumbing' },
  { name: 'Kitchen faucet (mid-grade)',             kind: 'material', unit: 'ea',   price: 220.00, category: 'Plumbing' },
  { name: 'Tub spout (slip-fit)',                   kind: 'material', unit: 'ea',   price: 25.00,  category: 'Plumbing' },
  { name: 'Shower valve trim kit',                  kind: 'material', unit: 'ea',   price: 185.00, category: 'Plumbing' },
  { name: 'Shower head (fixed)',                    kind: 'material', unit: 'ea',   price: 40.00,  category: 'Plumbing' },
  { name: 'Water heater 50gal electric',            kind: 'material', unit: 'ea',   price: 700.00, category: 'Plumbing' },
  { name: 'Water heater 50gal gas',                 kind: 'material', unit: 'ea',   price: 850.00, category: 'Plumbing' },
  { name: 'Tankless water heater (gas)',            kind: 'material', unit: 'ea',   price: 1400.00, category: 'Plumbing' },
  { name: 'P-trap 1.5"',                            kind: 'material', unit: 'ea',   price: 7.00,   category: 'Plumbing' },
  { name: 'Wax ring (with horn)',                   kind: 'material', unit: 'ea',   price: 4.00,   category: 'Plumbing' },
  { name: 'Master plumber',                         kind: 'labor',    unit: 'hr',   price: 125.00, category: 'Plumbing' },
  { name: 'Journeyman plumber',                     kind: 'labor',    unit: 'hr',   price: 100.00, category: 'Plumbing' },
  { name: 'Plumbing rough-in per fixture',          kind: 'labor',    unit: 'ea',   price: 300.00, category: 'Plumbing' },
  { name: 'Drain camera/inspection',                kind: 'subcontract', unit: 'lump', price: 250.00, category: 'Plumbing' },

  // ─── HVAC ────────────────────────────────────────────────────────────
  { name: '3-ton 16-SEER condenser',                kind: 'material', unit: 'ea',   price: 1800.00, category: 'HVAC' },
  { name: '4-ton 16-SEER condenser',                kind: 'material', unit: 'ea',   price: 2200.00, category: 'HVAC' },
  { name: 'Air handler 3-ton',                      kind: 'material', unit: 'ea',   price: 1400.00, category: 'HVAC' },
  { name: '80% gas furnace 80kBTU',                 kind: 'material', unit: 'ea',   price: 1500.00, category: 'HVAC' },
  { name: '96% gas furnace 80kBTU',                 kind: 'material', unit: 'ea',   price: 2100.00, category: 'HVAC' },
  { name: 'Flex duct R-8 25ft',                     kind: 'material', unit: 'ea',   price: 115.00,  category: 'HVAC' },
  { name: 'Sheet-metal trunk 8x20x60',              kind: 'material', unit: 'ea',   price: 90.00,   category: 'HVAC' },
  { name: 'Supply register 4x10',                   kind: 'material', unit: 'ea',   price: 8.00,    category: 'HVAC' },
  { name: 'Return grille 14x20',                    kind: 'material', unit: 'ea',   price: 14.00,   category: 'HVAC' },
  { name: 'Thermostat (programmable)',              kind: 'material', unit: 'ea',   price: 50.00,   category: 'HVAC' },
  { name: 'Thermostat (Wi-Fi smart)',               kind: 'material', unit: 'ea',   price: 200.00,  category: 'HVAC' },
  { name: 'Refrigerant line set 3/8"x3/4" 25ft',    kind: 'material', unit: 'ea',   price: 185.00,  category: 'HVAC' },
  { name: 'Disconnect 60A',                         kind: 'material', unit: 'ea',   price: 30.00,   category: 'HVAC' },
  { name: 'Condensate pump',                        kind: 'material', unit: 'ea',   price: 45.00,   category: 'HVAC' },
  { name: 'HVAC technician',                        kind: 'labor',    unit: 'hr',   price: 110.00,  category: 'HVAC' },
  { name: 'HVAC install — 3-ton split (lump)',      kind: 'subcontract', unit: 'lump', price: 1800.00, category: 'HVAC' },
  { name: 'Duct tie-in labor',                      kind: 'labor',    unit: 'hr',   price: 75.00,   category: 'HVAC' },

  // ─── Insulation & Drywall ────────────────────────────────────────────
  { name: 'R-13 fiberglass batt 3.5"',              kind: 'material', unit: 'sqft', price: 0.55,   category: 'Insulation & Drywall' },
  { name: 'R-19 fiberglass batt 6.25"',             kind: 'material', unit: 'sqft', price: 0.75,   category: 'Insulation & Drywall' },
  { name: 'R-30 attic batt',                        kind: 'material', unit: 'sqft', price: 1.10,   category: 'Insulation & Drywall' },
  { name: 'Blown cellulose R-30 (installed)',       kind: 'subcontract', unit: 'sqft', price: 0.90, category: 'Insulation & Drywall' },
  { name: 'Closed-cell spray foam (installed)',     kind: 'subcontract', unit: 'bdft', price: 1.50, category: 'Insulation & Drywall' },
  { name: 'XPS foam board 1" 4x8',                  kind: 'material', unit: 'sheet', price: 30.00, category: 'Insulation & Drywall' },
  { name: '1/2" drywall 4x8',                       kind: 'material', unit: 'sheet', price: 14.00, category: 'Insulation & Drywall' },
  { name: '5/8" Type X drywall 4x8',                kind: 'material', unit: 'sheet', price: 19.00, category: 'Insulation & Drywall' },
  { name: '1/2" green board 4x8',                   kind: 'material', unit: 'sheet', price: 18.00, category: 'Insulation & Drywall' },
  { name: 'Drywall screws 1.25" 5lb',               kind: 'material', unit: 'box',  price: 20.00,  category: 'Insulation & Drywall' },
  { name: 'Joint compound 4.5gal box',              kind: 'material', unit: 'box',  price: 18.00,  category: 'Insulation & Drywall' },
  { name: 'Mesh tape 250ft',                        kind: 'material', unit: 'roll', price: 6.00,   category: 'Insulation & Drywall' },
  { name: 'Paper tape 500ft',                       kind: 'material', unit: 'roll', price: 4.00,   category: 'Insulation & Drywall' },
  { name: 'Corner bead 8ft',                        kind: 'material', unit: 'ea',   price: 3.00,   category: 'Insulation & Drywall' },
  { name: 'Insulation labor',                       kind: 'labor',    unit: 'hr',   price: 45.00,  category: 'Insulation & Drywall' },
  { name: 'Drywall hanger',                         kind: 'labor',    unit: 'hr',   price: 50.00,  category: 'Insulation & Drywall' },
  { name: 'Drywall finisher (taper)',               kind: 'labor',    unit: 'hr',   price: 55.00,  category: 'Insulation & Drywall' },
  { name: 'Drywall hang & finish (per sf)',         kind: 'subcontract', unit: 'sqft', price: 1.85, category: 'Insulation & Drywall' },

  // ─── Finish Carpentry / Trim ─────────────────────────────────────────
  { name: 'Baseboard MDF 5.25" x 16ft',             kind: 'material', unit: 'ea',   price: 14.00,  category: 'Finish Carpentry' },
  { name: 'Casing MDF 3.5" x 8ft',                  kind: 'material', unit: 'ea',   price: 7.00,   category: 'Finish Carpentry' },
  { name: 'Crown MDF 3.5" x 8ft',                   kind: 'material', unit: 'ea',   price: 9.00,   category: 'Finish Carpentry' },
  { name: 'Window stool',                           kind: 'material', unit: 'lf',   price: 6.00,   category: 'Finish Carpentry' },
  { name: 'Interior pre-hung door 2/8',             kind: 'material', unit: 'ea',   price: 130.00, category: 'Finish Carpentry' },
  { name: 'Interior pre-hung door 3/0',             kind: 'material', unit: 'ea',   price: 145.00, category: 'Finish Carpentry' },
  { name: 'Exterior fiberglass slab door',          kind: 'material', unit: 'ea',   price: 400.00, category: 'Finish Carpentry' },
  { name: 'Pocket door frame kit',                  kind: 'material', unit: 'ea',   price: 90.00,  category: 'Finish Carpentry' },
  { name: 'Cabinet pull (4")',                      kind: 'material', unit: 'ea',   price: 4.00,   category: 'Finish Carpentry' },
  { name: 'Cabinet hinge (concealed)',              kind: 'material', unit: 'ea',   price: 3.00,   category: 'Finish Carpentry' },
  { name: 'Brad nails 18ga 2"',                     kind: 'material', unit: 'box',  price: 14.00,  category: 'Finish Carpentry' },
  { name: 'Finish nails 15ga 2.5"',                 kind: 'material', unit: 'box',  price: 20.00,  category: 'Finish Carpentry' },
  { name: 'Trim carpenter',                         kind: 'labor',    unit: 'hr',   price: 65.00,  category: 'Finish Carpentry' },
  { name: 'Cabinet install labor',                  kind: 'labor',    unit: 'hr',   price: 70.00,  category: 'Finish Carpentry' },
  { name: 'Door hang labor (per door)',             kind: 'labor',    unit: 'ea',   price: 80.00,  category: 'Finish Carpentry' },

  // ─── Flooring ────────────────────────────────────────────────────────
  { name: 'LVP 7" plank, mid-grade',                kind: 'material', unit: 'sqft', price: 3.20,   category: 'Flooring' },
  { name: 'Engineered hardwood 5" oak',             kind: 'material', unit: 'sqft', price: 5.50,   category: 'Flooring' },
  { name: 'Solid hardwood 3.25" oak',               kind: 'material', unit: 'sqft', price: 5.20,   category: 'Flooring' },
  { name: 'Porcelain tile 12x24',                   kind: 'material', unit: 'sqft', price: 3.40,   category: 'Flooring' },
  { name: 'Ceramic tile 12x12',                     kind: 'material', unit: 'sqft', price: 2.10,   category: 'Flooring' },
  { name: 'Carpet w/ pad, mid-grade',               kind: 'material', unit: 'sqft', price: 2.80,   category: 'Flooring' },
  { name: 'Underlayment foam (per sf)',             kind: 'material', unit: 'sqft', price: 0.35,   category: 'Flooring' },
  { name: 'Schluter Ditra 175 sf roll',             kind: 'material', unit: 'roll', price: 200.00, category: 'Flooring' },
  { name: 'Thinset 50lb',                           kind: 'material', unit: 'bag',  price: 32.00,  category: 'Flooring' },
  { name: 'Grout 25lb',                             kind: 'material', unit: 'bag',  price: 25.00,  category: 'Flooring' },
  { name: 'Tile spacers 1/8" (200ct)',              kind: 'material', unit: 'pkg',  price: 5.00,   category: 'Flooring' },
  { name: 'Transition / T-molding',                 kind: 'material', unit: 'ea',   price: 25.00,  category: 'Flooring' },
  { name: 'LVP install labor (per sf)',             kind: 'labor',    unit: 'sqft', price: 2.20,   category: 'Flooring' },
  { name: 'Hardwood install labor (per sf)',        kind: 'labor',    unit: 'sqft', price: 4.00,   category: 'Flooring' },
  { name: 'Tile install labor (per sf)',            kind: 'labor',    unit: 'sqft', price: 7.00,   category: 'Flooring' },
  { name: 'Carpet install labor (per sf)',          kind: 'labor',    unit: 'sqft', price: 1.20,   category: 'Flooring' },
  { name: 'Floor prep / leveling labor',            kind: 'labor',    unit: 'hr',   price: 55.00,  category: 'Flooring' },

  // ─── Painting ────────────────────────────────────────────────────────
  { name: 'Interior latex paint',                   kind: 'material', unit: 'gal',  price: 48.00,  category: 'Painting' },
  { name: 'Exterior latex paint',                   kind: 'material', unit: 'gal',  price: 58.00,  category: 'Painting' },
  { name: 'Primer (interior/exterior)',             kind: 'material', unit: 'gal',  price: 32.00,  category: 'Painting' },
  { name: 'Solid stain',                            kind: 'material', unit: 'gal',  price: 50.00,  category: 'Painting' },
  { name: 'Semi-transparent stain',                 kind: 'material', unit: 'gal',  price: 52.00,  category: 'Painting' },
  { name: "Painter's tape 1.88\"",                  kind: 'material', unit: 'roll', price: 7.00,   category: 'Painting' },
  { name: 'Drop cloth canvas 9x12',                 kind: 'material', unit: 'ea',   price: 20.00,  category: 'Painting' },
  { name: 'Roller cover 9"',                        kind: 'material', unit: 'ea',   price: 4.00,   category: 'Painting' },
  { name: 'Brush 2.5" angle',                       kind: 'material', unit: 'ea',   price: 14.00,  category: 'Painting' },
  { name: 'Painter (hourly)',                       kind: 'labor',    unit: 'hr',   price: 50.00,  category: 'Painting' },
  { name: 'Interior paint 2-coat (per sf walls)',   kind: 'subcontract', unit: 'sqft', price: 1.80, category: 'Painting' },
  { name: 'Exterior paint (per sf)',                kind: 'subcontract', unit: 'sqft', price: 2.20, category: 'Painting' },

  // ─── Decks / Outdoor ─────────────────────────────────────────────────
  { name: '5/4x6 PT decking 12ft',                  kind: 'material', unit: 'ea',   price: 19.00,  category: 'Decks' },
  { name: '5/4x6 PT decking 16ft',                  kind: 'material', unit: 'ea',   price: 25.00,  category: 'Decks' },
  { name: '5/4x6 cedar decking 12ft',               kind: 'material', unit: 'ea',   price: 32.00,  category: 'Decks' },
  { name: 'Trex Enhance Basics decking',            kind: 'material', unit: 'lf',   price: 4.80,   category: 'Decks' },
  { name: 'TimberTech AZEK decking',                kind: 'material', unit: 'lf',   price: 9.00,   category: 'Decks' },
  { name: 'Hidden deck fasteners (175 sf)',         kind: 'material', unit: 'box',  price: 145.00, category: 'Decks' },
  { name: 'Deck screws 3" coated 5lb',              kind: 'material', unit: 'box',  price: 50.00,  category: 'Decks' },
  { name: 'Joist tape 50ft',                        kind: 'material', unit: 'roll', price: 30.00,  category: 'Decks' },
  { name: 'Post anchor (Simpson AB66)',             kind: 'material', unit: 'ea',   price: 30.00,  category: 'Decks' },
  { name: 'Cable rail kit (10ft, 6 cables)',        kind: 'material', unit: 'ea',   price: 185.00, category: 'Decks' },
  { name: 'Aluminum baluster 32"',                  kind: 'material', unit: 'ea',   price: 5.00,   category: 'Decks' },
  { name: 'Composite handrail 16ft',                kind: 'material', unit: 'ea',   price: 95.00,  category: 'Decks' },
  { name: 'Stair stringer PT 7-step',               kind: 'material', unit: 'ea',   price: 32.00,  category: 'Decks' },
  { name: 'Newel post PT 4x4 8ft (cap)',            kind: 'material', unit: 'ea',   price: 35.00,  category: 'Decks' },
  { name: 'Deck builder (hourly)',                  kind: 'labor',    unit: 'hr',   price: 60.00,  category: 'Decks' },
  { name: 'Deck install — PT (per sf)',             kind: 'labor',    unit: 'sqft', price: 18.00,  category: 'Decks' },
  { name: 'Deck install — composite (per sf)',      kind: 'labor',    unit: 'sqft', price: 28.00,  category: 'Decks' },
  { name: 'Cable rail install labor (per lf)',      kind: 'labor',    unit: 'lf',   price: 35.00,  category: 'Decks' },

  // ─── Fencing ─────────────────────────────────────────────────────────
  { name: 'Fence post 4x4 PT 8ft',                  kind: 'material', unit: 'ea',   price: 13.00,  category: 'Fencing' },
  { name: 'Cedar picket 1x6x6ft',                   kind: 'material', unit: 'ea',   price: 4.00,   category: 'Fencing' },
  { name: 'PT picket 1x6x6ft',                      kind: 'material', unit: 'ea',   price: 3.00,   category: 'Fencing' },
  { name: 'PT 2x4x8ft fence rail',                  kind: 'material', unit: 'ea',   price: 9.00,   category: 'Fencing' },
  { name: 'Aluminum fence panel 6ft 4-rail',        kind: 'material', unit: 'ea',   price: 190.00, category: 'Fencing' },
  { name: 'Vinyl fence panel 6x8',                  kind: 'material', unit: 'ea',   price: 145.00, category: 'Fencing' },
  { name: 'Chain link 4ft x 50ft roll',             kind: 'material', unit: 'roll', price: 90.00,  category: 'Fencing' },
  { name: 'Fence post mix 50lb',                    kind: 'material', unit: 'bag',  price: 7.00,   category: 'Fencing' },
  { name: 'Gate hinge (heavy-duty pair)',           kind: 'material', unit: 'pair', price: 40.00,  category: 'Fencing' },
  { name: 'Self-closing gate latch',                kind: 'material', unit: 'ea',   price: 25.00,  category: 'Fencing' },
  { name: 'Fence labor — wood 6ft privacy (per lf)', kind: 'labor',   unit: 'lf',   price: 14.00,  category: 'Fencing' },
  { name: 'Fence labor — vinyl (per lf)',           kind: 'labor',    unit: 'lf',   price: 20.00,  category: 'Fencing' },
  { name: 'Fence labor — aluminum (per lf)',        kind: 'labor',    unit: 'lf',   price: 24.00,  category: 'Fencing' },
  { name: 'Gate install labor',                     kind: 'labor',    unit: 'ea',   price: 250.00, category: 'Fencing' },

  // ─── Hardscape / Patio ───────────────────────────────────────────────
  { name: 'Concrete paver 6x9',                     kind: 'material', unit: 'sqft', price: 4.50,   category: 'Hardscape' },
  { name: 'Travertine paver 16x24',                 kind: 'material', unit: 'sqft', price: 7.50,   category: 'Hardscape' },
  { name: 'Flagstone (random)',                     kind: 'material', unit: 'sqft', price: 9.00,   category: 'Hardscape' },
  { name: 'Bullnose pool coping',                   kind: 'material', unit: 'lf',   price: 14.00,  category: 'Hardscape' },
  { name: 'Polymeric sand 50lb',                    kind: 'material', unit: 'bag',  price: 35.00,  category: 'Hardscape' },
  { name: 'Edge restraint 6ft',                     kind: 'material', unit: 'ea',   price: 12.00,  category: 'Hardscape' },
  { name: 'Geotextile fabric 6x100',                kind: 'material', unit: 'roll', price: 80.00,  category: 'Hardscape' },
  { name: 'CMU block 8x8x16',                       kind: 'material', unit: 'ea',   price: 3.00,   category: 'Hardscape' },
  { name: 'Versa-Lok wall block',                   kind: 'material', unit: 'ea',   price: 5.00,   category: 'Hardscape' },
  { name: 'Paver patio install (per sf)',           kind: 'labor',    unit: 'sqft', price: 14.00,  category: 'Hardscape' },
  { name: 'Retaining wall install (per sf face)',   kind: 'labor',    unit: 'sqft', price: 40.00,  category: 'Hardscape' },
  { name: 'Mason / brick layer',                    kind: 'labor',    unit: 'hr',   price: 70.00,  category: 'Hardscape' },

  // ─── Landscape & Irrigation ──────────────────────────────────────────
  { name: 'Sod (per pallet, 500 sf)',               kind: 'material', unit: 'pallet', price: 375.00, category: 'Landscape' },
  { name: 'Pine straw bale',                        kind: 'material', unit: 'bale', price: 6.00,   category: 'Landscape' },
  { name: 'Hardwood mulch',                         kind: 'material', unit: 'cuyd', price: 40.00,  category: 'Landscape' },
  { name: 'Black landscape edging 20ft',            kind: 'material', unit: 'ea',   price: 25.00,  category: 'Landscape' },
  { name: 'Landscape fabric 4x100',                 kind: 'material', unit: 'roll', price: 35.00,  category: 'Landscape' },
  { name: 'Tree (15-gal)',                          kind: 'material', unit: 'ea',   price: 90.00,  category: 'Landscape' },
  { name: 'Shrub (3-gal)',                          kind: 'material', unit: 'ea',   price: 20.00,  category: 'Landscape' },
  { name: 'Perennial (1-gal)',                      kind: 'material', unit: 'ea',   price: 11.00,  category: 'Landscape' },
  { name: 'Irrigation poly tubing 1/2" 100ft',      kind: 'material', unit: 'roll', price: 20.00,  category: 'Landscape' },
  { name: 'Pop-up rotor sprinkler 4"',              kind: 'material', unit: 'ea',   price: 14.00,  category: 'Landscape' },
  { name: 'Drip emitter 1gph (25ct)',               kind: 'material', unit: 'pkg',  price: 9.00,   category: 'Landscape' },
  { name: 'Solenoid valve 1"',                      kind: 'material', unit: 'ea',   price: 30.00,  category: 'Landscape' },
  { name: 'Backflow preventer (RPZ 3/4")',          kind: 'material', unit: 'ea',   price: 145.00, category: 'Landscape' },
  { name: 'Irrigation controller (6-zone)',         kind: 'material', unit: 'ea',   price: 185.00, category: 'Landscape' },
  { name: 'Landscaper (hourly)',                    kind: 'labor',    unit: 'hr',   price: 45.00,  category: 'Landscape' },
  { name: 'Sod install (per pallet)',               kind: 'labor',    unit: 'pallet', price: 200.00, category: 'Landscape' },
  { name: 'Irrigation install per zone',            kind: 'labor',    unit: 'zone', price: 450.00, category: 'Landscape' },
  { name: 'Tree planting (15-gal each)',            kind: 'labor',    unit: 'ea',   price: 100.00, category: 'Landscape' },

  // ─── Windows & Doors ─────────────────────────────────────────────────
  { name: 'Single-hung vinyl 36x60',                kind: 'material', unit: 'ea',   price: 360.00, category: 'Windows & Doors' },
  { name: 'Double-hung vinyl 36x60',                kind: 'material', unit: 'ea',   price: 440.00, category: 'Windows & Doors' },
  { name: 'Casement vinyl 24x48',                   kind: 'material', unit: 'ea',   price: 480.00, category: 'Windows & Doors' },
  { name: 'Slider vinyl 60x36',                     kind: 'material', unit: 'ea',   price: 510.00, category: 'Windows & Doors' },
  { name: 'Picture window 60x48',                   kind: 'material', unit: 'ea',   price: 560.00, category: 'Windows & Doors' },
  { name: 'Sliding patio door 6ft vinyl',           kind: 'material', unit: 'ea',   price: 850.00, category: 'Windows & Doors' },
  { name: 'French patio door 6ft fiberglass',       kind: 'material', unit: 'ea',   price: 1800.00, category: 'Windows & Doors' },
  { name: 'Garage door 16x7 insulated steel',       kind: 'material', unit: 'ea',   price: 1250.00, category: 'Windows & Doors' },
  { name: 'Garage door opener (belt drive)',        kind: 'material', unit: 'ea',   price: 350.00, category: 'Windows & Doors' },
  { name: 'Window install — retrofit (per opening)', kind: 'labor',   unit: 'ea',   price: 325.00, category: 'Windows & Doors' },
  { name: 'Exterior door install',                  kind: 'labor',    unit: 'ea',   price: 400.00, category: 'Windows & Doors' },
  { name: 'Garage door install',                    kind: 'labor',    unit: 'ea',   price: 400.00, category: 'Windows & Doors' },

  // ─── Kitchen & Bath ──────────────────────────────────────────────────
  { name: 'Stock cabinet base 24"',                 kind: 'material', unit: 'ea',   price: 260.00, category: 'Kitchen & Bath' },
  { name: 'Stock cabinet wall 30x30',               kind: 'material', unit: 'ea',   price: 285.00, category: 'Kitchen & Bath' },
  { name: 'Quartz countertop (installed)',          kind: 'subcontract', unit: 'sqft', price: 75.00, category: 'Kitchen & Bath' },
  { name: 'Granite countertop (installed)',         kind: 'subcontract', unit: 'sqft', price: 65.00, category: 'Kitchen & Bath' },
  { name: 'Laminate countertop (installed)',        kind: 'subcontract', unit: 'sqft', price: 35.00, category: 'Kitchen & Bath' },
  { name: 'Undermount sink 30" SS',                 kind: 'material', unit: 'ea',   price: 290.00, category: 'Kitchen & Bath' },
  { name: 'Drop-in sink 33" SS',                    kind: 'material', unit: 'ea',   price: 200.00, category: 'Kitchen & Bath' },
  { name: 'Vanity 36" w/ top',                      kind: 'material', unit: 'ea',   price: 480.00, category: 'Kitchen & Bath' },
  { name: 'Vanity light bar',                       kind: 'material', unit: 'ea',   price: 90.00,  category: 'Kitchen & Bath' },
  { name: 'Tub 60" alcove',                         kind: 'material', unit: 'ea',   price: 390.00, category: 'Kitchen & Bath' },
  { name: 'Shower base 60x36',                      kind: 'material', unit: 'ea',   price: 460.00, category: 'Kitchen & Bath' },
  { name: 'Shower kit (rough-in valve + trim)',     kind: 'material', unit: 'ea',   price: 400.00, category: 'Kitchen & Bath' },
  { name: 'Tile niche pre-fab 12x24',               kind: 'material', unit: 'ea',   price: 80.00,  category: 'Kitchen & Bath' },

  // ─── General Conditions / Overhead ───────────────────────────────────
  { name: 'Dumpster 20-yard rental',                kind: 'fee',      unit: 'lump', price: 450.00, category: 'General Conditions' },
  { name: 'Port-a-john monthly rental',             kind: 'fee',      unit: 'month', price: 175.00, category: 'General Conditions' },
  { name: 'Permit fee — residential addition',      kind: 'fee',      unit: 'lump', price: 400.00, category: 'General Conditions' },
  { name: 'Permit fee — deck',                      kind: 'fee',      unit: 'lump', price: 150.00, category: 'General Conditions' },
  { name: 'Plan review fee',                        kind: 'fee',      unit: 'lump', price: 250.00, category: 'General Conditions' },
  { name: 'Survey',                                 kind: 'subcontract', unit: 'lump', price: 650.00, category: 'General Conditions' },
  { name: 'Engineering stamp (structural)',         kind: 'subcontract', unit: 'lump', price: 450.00, category: 'General Conditions' },
  { name: 'General laborer',                        kind: 'labor',    unit: 'hr',   price: 35.00,  category: 'General Conditions' },
  { name: 'Foreman / lead carpenter',               kind: 'labor',    unit: 'hr',   price: 75.00,  category: 'General Conditions' },
  { name: 'Project manager (PM time)',              kind: 'labor',    unit: 'hr',   price: 90.00,  category: 'General Conditions' },
];

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const item of ITEMS) {
    // Idempotent on (name + unit) — same name with a different unit is
    // treated as a separate product (e.g. drywall by sheet vs sqft).
    const existing = await prisma.product.findFirst({
      where: { name: item.name, unit: item.unit ?? null },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.product.create({
      data: {
        name: item.name,
        kind: item.kind,
        unit: item.unit,
        defaultUnitPriceCents: Math.round(item.price * 100),
        category: item.category,
        notes: item.notes ?? null,
        active: true,
      },
    });
    inserted++;
  }

  console.log(`[seed:catalog] done — inserted ${inserted}, skipped ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
