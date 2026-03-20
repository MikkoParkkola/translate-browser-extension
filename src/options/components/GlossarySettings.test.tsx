/**
 * GlossarySettings component unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
  },
});

vi.mock('../../core/glossary', () => ({
  glossary: {
    getGlossary: vi.fn().mockResolvedValue({}),
    addTerm: vi.fn().mockResolvedValue(undefined),
    removeTerm: vi.fn().mockResolvedValue(undefined),
    clearGlossary: vi.fn().mockResolvedValue(undefined),
    exportGlossary: vi.fn().mockResolvedValue('{}'),
    importGlossary: vi.fn().mockResolvedValue(0),
  },
}));

import { GlossarySettings } from './GlossarySettings';
import { glossary } from '../../core/glossary';

const MOCK_TERMS = {
  API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
  cloud: { replacement: 'pilvi', caseSensitive: false, description: '[fi] cloud computing' },
  server: { replacement: 'palvelin', caseSensitive: false },
};

describe('GlossarySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  describe('initial render — empty state', () => {
    it('renders section title', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Glossary')).toBeTruthy();
      });
    });

    it('shows empty state message', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('No glossary terms defined yet')).toBeTruthy();
      });
    });

    it('shows search input', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByPlaceholderText('Search terms...')).toBeTruthy();
      });
    });

    it('shows + Add Term button', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('+ Add Term')).toBeTruthy();
      });
    });

    it('shows Import/Export section', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Import / Export')).toBeTruthy();
      });
    });

    it('shows Terms (0) count', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Terms (0)')).toBeTruthy();
      });
    });
  });

  describe('initial render — with terms', () => {
    beforeEach(() => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    });

    it('renders term source and replacement', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('API')).toBeTruthy();
        expect(screen.getByText('rajapinta')).toBeTruthy();
      });
    });

    it('shows Aa badge for case-sensitive terms', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Aa')).toBeTruthy();
      });
    });

    it('shows language tag when description has [lang] prefix', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('fi')).toBeTruthy();
      });
    });

    it('shows correct term count', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Terms (3)')).toBeTruthy();
      });
    });

    it('shows Edit and Delete buttons per term', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        const editBtns = screen.getAllByText('Edit');
        expect(editBtns.length).toBe(3);
        const deleteBtns = screen.getAllByText('Delete');
        expect(deleteBtns.length).toBe(3);
      });
    });

    it('shows Clear All button when terms exist', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Clear All')).toBeTruthy();
      });
    });
  });

  describe('add form', () => {
    it('opens add form on + Add Term click', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Term')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Term'));
      expect(screen.getByText('Add New Term')).toBeTruthy();
      expect(screen.getByPlaceholderText('e.g., API')).toBeTruthy();
      expect(screen.getByPlaceholderText('e.g., rajapinta')).toBeTruthy();
    });

    it('button label changes to Cancel when open', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Term')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Term'));
      // Multiple Cancel buttons: the toggle button + the form's own Cancel
      expect(screen.getAllByText('Cancel').length).toBeGreaterThanOrEqual(1);
    });

    it('shows error when source or target is empty', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Term')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Term'));
      fireEvent.click(screen.getByText('Add Term'));
      await vi.waitFor(() => {
        expect(screen.getByText('Source and target terms are required')).toBeTruthy();
      });
    });

    it('calls addTerm and reloads on valid submission', async () => {
      (glossary.addTerm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (glossary.getGlossary as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({})
        .mockResolvedValue({ API: { replacement: 'rajapinta', caseSensitive: false } });

      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Term')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Term'));

      const sourceInput = screen.getByPlaceholderText('e.g., API');
      const targetInput = screen.getByPlaceholderText('e.g., rajapinta');
      fireEvent.input(sourceInput, { target: { value: 'API' } });
      fireEvent.input(targetInput, { target: { value: 'rajapinta' } });
      fireEvent.click(screen.getByText('Add Term'));

      await vi.waitFor(() => {
        expect(glossary.addTerm).toHaveBeenCalledWith('API', 'rajapinta', false, undefined);
      });
    });

    it('includes language prefix in description when language selected', async () => {
      (glossary.addTerm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Term')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Term'));

      const sourceInput = screen.getByPlaceholderText('e.g., API');
      const targetInput = screen.getByPlaceholderText('e.g., rajapinta');
      fireEvent.input(sourceInput, { target: { value: 'cloud' } });
      fireEvent.input(targetInput, { target: { value: 'pilvi' } });

      // Change language to Finnish — two "All Languages" selects exist when form is open
      // (toolbar select + form select); pick the form's language select by index
      const langSelects = screen.getAllByDisplayValue('All Languages');
      const formLangSelect = langSelects[langSelects.length - 1];
      fireEvent.change(formLangSelect, { target: { value: 'fi' } });
      fireEvent.click(screen.getByText('Add Term'));

      await vi.waitFor(() => {
        expect(glossary.addTerm).toHaveBeenCalledWith('cloud', 'pilvi', false, '[fi] ');
      });
    });

    it('shows error when addTerm throws', async () => {
      (glossary.addTerm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('+ Add Term')).toBeTruthy());
      fireEvent.click(screen.getByText('+ Add Term'));
      const sourceInput = screen.getByPlaceholderText('e.g., API');
      const targetInput = screen.getByPlaceholderText('e.g., rajapinta');
      fireEvent.input(sourceInput, { target: { value: 'API' } });
      fireEvent.input(targetInput, { target: { value: 'rajapinta' } });
      fireEvent.click(screen.getByText('Add Term'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to add term')).toBeTruthy();
      });
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    });

    it('clicking Edit opens edit form', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(3));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => {
        expect(screen.getByText('Save')).toBeTruthy();
      });
    });

    it('shows error when saving with empty replacement', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(3));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      // Clear the replacement input
      const replacementInputs = screen.getAllByRole('textbox');
      // The edit Replacement input is the second one in the edit row (source is disabled)
      const editableInputs = replacementInputs.filter(
        (el) => !(el as HTMLInputElement).disabled
      );
      const replacementInput = editableInputs.find(
        (el) => (el as HTMLInputElement).value === 'rajapinta'
      ) || editableInputs[0];
      fireEvent.input(replacementInput, { target: { value: '' } });
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(screen.getByText('Target term is required')).toBeTruthy();
      });
    });

    it('calls addTerm on save', async () => {
      (glossary.addTerm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(3));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(glossary.addTerm).toHaveBeenCalled();
      });
    });

    it('Cancel in edit mode exits edit', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(3));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      const cancelBtns = screen.getAllByText('Cancel');
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);
      await vi.waitFor(() => {
        expect(screen.queryByText('Save')).toBeNull();
      });
    });

    it('shows error when save throws', async () => {
      (glossary.addTerm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Edit').length).toBe(3));
      fireEvent.click(screen.getAllByText('Edit')[0]);
      await vi.waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
      fireEvent.click(screen.getByText('Save'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to update term')).toBeTruthy();
      });
    });
  });

  describe('delete term', () => {
    beforeEach(() => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    });

    it('calls removeTerm when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      (glossary.removeTerm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(3));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      await vi.waitFor(() => {
        expect(glossary.removeTerm).toHaveBeenCalled();
      });
    });

    it('does not call removeTerm when cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(3));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      expect(glossary.removeTerm).not.toHaveBeenCalled();
    });

    it('shows error when removeTerm throws', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      (glossary.removeTerm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getAllByText('Delete').length).toBe(3));
      fireEvent.click(screen.getAllByText('Delete')[0]);
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to delete term')).toBeTruthy();
      });
    });
  });

  describe('clear all', () => {
    beforeEach(() => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    });

    it('calls clearGlossary when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      (glossary.clearGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('Clear All')).toBeTruthy());
      fireEvent.click(screen.getByText('Clear All'));
      await vi.waitFor(() => {
        expect(glossary.clearGlossary).toHaveBeenCalled();
      });
    });

    it('does not call clearGlossary when cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('Clear All')).toBeTruthy());
      fireEvent.click(screen.getByText('Clear All'));
      expect(glossary.clearGlossary).not.toHaveBeenCalled();
    });

    it('shows error when clearGlossary throws', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      (glossary.clearGlossary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('Clear All')).toBeTruthy());
      fireEvent.click(screen.getByText('Clear All'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to clear glossary')).toBeTruthy();
      });
    });
  });

  describe('search and filter', () => {
    beforeEach(() => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TERMS);
    });

    it('filtering by search query shows matching terms', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('API')).toBeTruthy());
      const searchInput = screen.getByPlaceholderText('Search terms...');
      fireEvent.input(searchInput, { target: { value: 'api' } });
      await vi.waitFor(() => {
        expect(screen.getByText('Terms (1)')).toBeTruthy();
      });
    });

    it('shows "No matching terms found" when no search results', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('API')).toBeTruthy());
      const searchInput = screen.getByPlaceholderText('Search terms...');
      fireEvent.input(searchInput, { target: { value: 'zzznomatch' } });
      await vi.waitFor(() => {
        expect(screen.getByText('No matching terms found')).toBeTruthy();
      });
    });

    it('filtering by language shows matching terms including language-agnostic ones', async () => {
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('Terms (3)')).toBeTruthy());
      const langSelect = screen.getByDisplayValue('All Languages');
      fireEvent.change(langSelect, { target: { value: 'de' } });
      await vi.waitFor(() => {
        // Terms with no lang tag (API, server) still pass when filtering because termLang='all'
        // cloud has [fi] tag so is filtered OUT for 'de'
        expect(screen.getByText('Terms (2)')).toBeTruthy();
      });
    });
  });

  describe('export', () => {
    it('calls exportGlossary on Export JSON click', async () => {
      vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:url'), revokeObjectURL: vi.fn() });
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('Export JSON')).toBeTruthy());
      fireEvent.click(screen.getByText('Export JSON'));
      await vi.waitFor(() => {
        expect(glossary.exportGlossary).toHaveBeenCalled();
      });
    });

    it('shows error when exportGlossary throws', async () => {
      (glossary.exportGlossary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => expect(screen.getByText('Export JSON')).toBeTruthy());
      fireEvent.click(screen.getByText('Export JSON'));
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to export glossary')).toBeTruthy();
      });
    });

    it('shows error when load fails', async () => {
      (glossary.getGlossary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'));
      render(() => <GlossarySettings />);
      await vi.waitFor(() => {
        expect(screen.getByText('Failed to load glossary')).toBeTruthy();
      });
    });
  });
});
