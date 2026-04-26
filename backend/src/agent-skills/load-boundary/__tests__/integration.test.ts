import { describe, it, expect } from '@jest/globals';
import { listBuiltinLoadBoundarySkills, getBuiltinLoadBoundarySkill } from '../entry.js';

describe('LoadBoundary Integration Tests', () => {
  describe('Skill Registry', () => {
    it('should list all built-in load-boundary skills', () => {
      const skills = listBuiltinLoadBoundarySkills();

      expect(skills).toBeDefined();
      expect(skills.length).toBeGreaterThan(0);
      expect(skills).toHaveLength(10);

      // Verify all expected skills are present
      const skillIds = skills.map((s) => s.id);
      expect(skillIds).toContain('dead-load');
      expect(skillIds).toContain('live-load');
      expect(skillIds).toContain('wind-load');
      expect(skillIds).toContain('seismic-load');
      expect(skillIds).toContain('snow-load');
      expect(skillIds).toContain('temperature-load');
      expect(skillIds).toContain('crane-load');
      expect(skillIds).toContain('load-combination');
      expect(skillIds).toContain('boundary-condition');
      expect(skillIds).toContain('nodal-constraint');
    });

    it('should get a specific skill by ID', () => {
      const deadLoadSkill = getBuiltinLoadBoundarySkill('dead-load');

      expect(deadLoadSkill).toBeDefined();
      expect(deadLoadSkill?.id).toBe('dead-load');
      expect(deadLoadSkill?.domain).toBe('load-boundary');
      expect(deadLoadSkill?.name?.en).toBe('Dead Load');
      expect(deadLoadSkill?.name?.zh).toBe('恒荷载');
      expect(deadLoadSkill?.capabilities).toContain('load-generation');
    });

    it('should return undefined for non-existent skill', () => {
      const nonExistentSkill = getBuiltinLoadBoundarySkill('non-existent' as any);
      expect(nonExistentSkill).toBeUndefined();
    });
  });

  describe('Skill Manifests', () => {
    it('should have all required fields for each skill', () => {
      const skills = listBuiltinLoadBoundarySkills();

      for (const skill of skills) {
        expect(skill.id).toBeDefined();
        expect(skill.domain).toBe('load-boundary');
        expect(skill.name).toBeDefined();
        expect(skill.description).toBeDefined();
        expect(skill.version).toBeDefined();
        expect(skill.priority).toBeDefined();
        expect(skill.capabilities).toBeDefined();
        expect(skill.compatibility).toBeDefined();
      }
    });

    it('should have bilingual names and descriptions', () => {
      const skills = listBuiltinLoadBoundarySkills();

      for (const skill of skills) {
        expect(skill.name?.en).toBeDefined();
        expect(skill.name?.zh).toBeDefined();
        expect(skill.description?.en).toBeDefined();
        expect(skill.description?.zh).toBeDefined();
      }
    });

    it('should have supportedModelFamilies for most skills', () => {
      const skills = listBuiltinLoadBoundarySkills();

      for (const skill of skills) {
        expect(skill.supportedModelFamilies).toBeDefined();
        if (skill.id !== 'temperature-load') {
          expect(skill.supportedModelFamilies).toContain('generic');
        }
      }
    });
  });

  describe('Skill Capabilities', () => {
    it('should have load-generation capability for load skills', () => {
      const loadSkillIds = ['dead-load', 'live-load', 'wind-load', 'seismic-load', 'temperature-load', 'crane-load'];

      for (const skillId of loadSkillIds) {
        const skill = getBuiltinLoadBoundarySkill(skillId as any);
        expect(skill?.capabilities).toContain('load-generation');
      }
    });

    it('should have boundary-definition capability for boundary skills', () => {
      const boundarySkillIds = ['boundary-condition', 'nodal-constraint'];

      for (const skillId of boundarySkillIds) {
        const skill = getBuiltinLoadBoundarySkill(skillId as any);
        expect(skill?.capabilities).toContain('boundary-definition');
      }
    });

    it('should have load-combination capability for load-combination skill', () => {
      const skill = getBuiltinLoadBoundarySkill('load-combination');
      expect(skill?.capabilities).toContain('load-combination');
    });
  });

  describe('Priority Order', () => {
    it('should have reasonable priority values', () => {
      const skills = listBuiltinLoadBoundarySkills();

      for (const skill of skills) {
        expect(skill.priority).toBeGreaterThan(0);
        expect(skill.priority).toBeLessThanOrEqual(200);
      }
    });

    it('should have core skills with higher priority', () => {
      const deadLoad = getBuiltinLoadBoundarySkill('dead-load');
      const seismicLoad = getBuiltinLoadBoundarySkill('seismic-load');
      const loadCombination = getBuiltinLoadBoundarySkill('load-combination');
      const temperatureLoad = getBuiltinLoadBoundarySkill('temperature-load');

      expect(deadLoad?.priority).toBeGreaterThanOrEqual(95);
      expect(seismicLoad?.priority).toBeGreaterThanOrEqual(90);
      expect(loadCombination?.priority).toBeGreaterThanOrEqual(95);
      expect(temperatureLoad?.priority).toBeLessThan(deadLoad?.priority ?? 100);
    });
  });
});
