import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ThoughtStep } from '@kg/shared';
import AgentThoughtTimeline from './AgentThoughtTimeline.vue';

const steps: ThoughtStep[] = [
  {
    id: 's1',
    phase: 'plan',
    title: 'Plan retrieval strategy',
    detail: 'Decide which subgraph to explore.',
    status: 'done',
    durationMs: 420,
  },
  {
    id: 's2',
    phase: 'retrieve',
    title: 'Retrieve top chunks',
    detail: '',
    status: 'running',
  },
];

describe('AgentThoughtTimeline', () => {
  it('renders each thought step with its title and phase label', () => {
    const wrapper = mount(AgentThoughtTimeline, {
      props: { steps, active: true },
    });

    const text = wrapper.text();
    expect(text).toContain('Plan retrieval strategy');
    expect(text).toContain('Retrieve top chunks');
    expect(text).toContain('Plan');
    expect(text).toContain('Retrieve');
    // Duration label rendered for the finished step.
    expect(text).toContain('420ms');
    // One <li> per step.
    expect(wrapper.findAll('li')).toHaveLength(2);
  });

  it('shows an empty-state hint when there are no steps', () => {
    const wrapper = mount(AgentThoughtTimeline, {
      props: { steps: [] },
    });
    expect(wrapper.text()).toContain("agent's reasoning will stream here");
  });
});
