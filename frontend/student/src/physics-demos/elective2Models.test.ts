import { describe, expect, it } from 'vitest';
import { leftHandRuleState } from './elective2Models';

describe('leftHandRuleState', () => {
  it('describes the positive-charge left-hand rule chain', () => {
    const state = leftHandRuleState({ fieldDirection: 1, carrierSign: 1 });

    expect(state.forceLabel).toBe('F：向上');
    expect(state.equivalentCurrentLabel).toBe('等效电流：向右');
    expect(state.decisionSteps).toContain('四指指向电流 I，或正电荷速度 v。');
  });

  it('converts negative charge motion to equivalent current before judging force', () => {
    const state = leftHandRuleState({ fieldDirection: 1, carrierSign: -1 });

    expect(state.forceLabel).toBe('F：向下');
    expect(state.equivalentCurrentLabel).toBe('等效电流：向左');
    expect(state.decisionSteps).toContain('负电荷向右运动时，先把它换成等效电流向左。');
    expect(state.commonMistake).toContain('负电荷');
  });
});
