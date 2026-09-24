import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useCorpusStore } from '@/stores/corpus';
import IngestPanel from './IngestPanel.vue';

describe('IngestPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('offers the composer and the reset button on a writable backend', () => {
    const wrapper = mount(IngestPanel);
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.text()).toContain('Reset corpus');
    expect(wrapper.find('[data-testid="read-only-notice"]').exists()).toBe(false);
  });

  it('hides ingest and reset and explains why on the read-only demo', async () => {
    useCorpusStore().readOnly = true;
    const wrapper = mount(IngestPanel);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Reset corpus');
    const notice = wrapper.find('[data-testid="read-only-notice"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toMatch(/read-only/i);
  });
});
