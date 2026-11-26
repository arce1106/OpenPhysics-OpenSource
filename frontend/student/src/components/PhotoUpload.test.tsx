import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PhotoUpload from './PhotoUpload';

vi.mock('../api/client', () => ({
  api: {
    submitPhoto: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
}));

describe('PhotoUpload', () => {
  it('allows iPad users to choose an image from the photo library instead of forcing camera capture', () => {
    const { container } = render(<PhotoUpload questionId="q1" onResult={vi.fn()} />);

    const input = container.querySelector('input[type="file"]');

    expect(screen.getByText('点击选择手写解答照片')).toBeInTheDocument();
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).not.toHaveAttribute('capture');
  });

  it('uses an accessible overlay icon to remove a selected photo draft', async () => {
    const onDraftChange = vi.fn();

    render(
      <PhotoUpload
        questionId="q1"
        onResult={vi.fn()}
        deferUpload
        draft={{
          file: new File(['photo'], 'solution.png', { type: 'image/png' }),
          previewUrl: 'blob:solution',
        }}
        onDraftChange={onDraftChange}
      />,
    );

    const remove = screen.getByRole('button', { name: '移除已选图片' });
    expect(remove).toHaveClass('photo-upload-remove');
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument();

    await userEvent.click(remove);

    expect(onDraftChange).toHaveBeenCalledWith(null);
  });
});
