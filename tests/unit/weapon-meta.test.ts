import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWeaponMeta, scanWeaponMeta } from '../../server/game/weapon-meta.js';

const META = `<?xml version="1.0" encoding="UTF-8"?>
<CWeaponInfoBlob>
  <Infos>
    <Item>
      <Infos>
        <Item type="CWeaponInfo">
          <Name>WEAPON_ADDON</Name>
          <Model>w_pi_addon</Model>
          <DamageType>BULLET</DamageType>
          <Damage value="42.5" />
          <Speed value="1500.0" />
          <WeaponRange value="90.0" />
          <NetworkPlayerDamageModifier value="1.5" />
          <HeadShotDamageModifierPlayer value="3.0" />
          <!-- <Damage value="999" /> -->
          <AttachPoints>
            <Item>
              <Damage value="1000" />
            </Item>
          </AttachPoints>
        </Item>
        <Item type="CWeaponInfo">
          <Name>WEAPON_OTHER</Name>
          <Damage value="10" />
        </Item>
      </Infos>
    </Item>
  </Infos>
</CWeaponInfoBlob>`;

describe('weapon meta parser', () => {
  it('reads damage, range and speed per weapon and ignores nested items and comments', () => {
    const weapons = parseWeaponMeta(META, 'addon_guns');
    expect([...weapons.keys()]).toEqual(['WEAPON_ADDON', 'WEAPON_OTHER']);
    expect(weapons.get('WEAPON_ADDON')).toEqual({
      source: 'addon_guns',
      model: 'w_pi_addon',
      damageType: 'BULLET',
      Damage: 42.5,
      Speed: 1500,
      WeaponRange: 90,
      NetworkPlayerDamageModifier: 1.5,
      HeadShotDamageModifierPlayer: 3,
    });
    expect(weapons.get('WEAPON_OTHER')?.Damage).toBe(10);
  });

  it('scans nested resource folders and lets later resources win', () => {
    const root = mkdtempSync(join(tmpdir(), 'simpleac-weapons-'));
    try {
      const first = join(root, 'a_pack', 'stream');
      const second = join(root, 'b_pack', 'data');
      mkdirSync(first, { recursive: true });
      mkdirSync(second, { recursive: true });
      writeFileSync(join(first, 'weapons.meta'), META);
      writeFileSync(join(first, 'unrelated.meta'), '<Other/>');
      writeFileSync(join(second, 'weapons.meta'), META.replace('42.5', '60'));
      const scanned = scanWeaponMeta([
        { name: 'a_pack', path: join(root, 'a_pack') },
        { name: 'b_pack', path: join(root, 'b_pack') },
      ]);
      expect(scanned['WEAPON_ADDON']?.Damage).toBe(60);
      expect(scanned['WEAPON_ADDON']?.source).toBe('b_pack');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
