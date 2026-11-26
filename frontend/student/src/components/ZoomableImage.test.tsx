import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ZoomableImage from './ZoomableImage';

function setImageNaturalSize(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
}

describe('ZoomableImage', () => {
  it('opens a large preview when the image is clicked and closes with Escape', () => {
    render(<ZoomableImage src="/static/example.jpg" alt="学生作答图片" />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看：学生作答图片' }));

    expect(screen.getByRole('dialog', { name: '图片放大查看' })).toBeInTheDocument();
    expect(screen.getByAltText('学生作答图片 放大图')).toHaveAttribute('src', '/static/example.jpg');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '图片放大查看' })).not.toBeInTheDocument();
  });

  it('lets students zoom the preview image in and reset it', () => {
    render(<ZoomableImage src="/static/example.jpg" alt="题目附图" />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看：题目附图' }));
    fireEvent.click(screen.getByRole('button', { name: '放大图片' }));

    expect(screen.getByAltText('题目附图 放大图')).toHaveStyle({
      transform: 'scale(1.25) rotate(0deg)',
    });

    fireEvent.click(screen.getByRole('button', { name: '重置图片缩放' }));

    expect(screen.getByAltText('题目附图 放大图')).toHaveStyle({
      transform: 'scale(1) rotate(0deg)',
    });
  });

  it('marks very wide question images for compact inline preview sizing', () => {
    render(
      <ZoomableImage
        src="/static/timeline.png"
        alt="题目附图"
        className="question-image question-image-inline"
      />,
    );

    const image = screen.getByRole('img', { name: '题目附图' }) as HTMLImageElement;
    setImageNaturalSize(image, 1800, 320);
    fireEvent.load(image);

    expect(image).toHaveClass('question-image-ultrawide');
  });

  it('keeps normal question images on the default preview sizing path', () => {
    render(
      <ZoomableImage
        src="/static/experiment.png"
        alt="题目附图"
        className="question-image question-image-inline"
      />,
    );

    const image = screen.getByRole('img', { name: '题目附图' }) as HTMLImageElement;
    setImageNaturalSize(image, 760, 460);
    fireEvent.load(image);

    expect(image).not.toHaveClass('question-image-ultrawide');
  });
});
