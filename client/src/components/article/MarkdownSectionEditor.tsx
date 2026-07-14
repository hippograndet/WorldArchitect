import { forwardRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

const TOOLBAR: { label: string; title: string; active: (editor: ReturnType<typeof useEditor>) => boolean; action: (editor: ReturnType<typeof useEditor>) => void }[] = [
  { label: 'B',  title: 'Bold',      active: (e) => e?.isActive('bold') ?? false,              action: (e) => e?.chain().focus().toggleBold().run() },
  { label: 'I',  title: 'Italic',    active: (e) => e?.isActive('italic') ?? false,            action: (e) => e?.chain().focus().toggleItalic().run() },
  { label: 'H2', title: 'Heading 2', active: (e) => e?.isActive('heading', { level: 2 }) ?? false, action: (e) => e?.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'H3', title: 'Heading 3', active: (e) => e?.isActive('heading', { level: 3 }) ?? false, action: (e) => e?.chain().focus().toggleHeading({ level: 3 }).run() },
];

interface Props {
  initialContent: string;
}

export interface MarkdownSectionEditorHandle {
  getMarkdown: () => string;
}

const MarkdownSectionEditor = forwardRef<MarkdownSectionEditorHandle, Props>(({ initialContent }, ref) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: initialContent,
  });

  useImperativeHandle(ref, () => ({
    getMarkdown: () => ((editor?.storage.markdown.getMarkdown() as string | undefined) ?? '').trim(),
  }), [editor]);

  return (
    <div className="border border-blue-300 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 bg-gray-50">
        {TOOLBAR.map(({ label, title, active, action }) => (
          <button
            key={label}
            title={title}
            onMouseDown={(e) => { e.preventDefault(); action(editor); }}
            className={`px-2 py-0.5 text-xs rounded ${active(editor) ? 'bg-gray-200 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Editor */}
      <EditorContent
        editor={editor}
        className="prose prose-gray max-w-none p-4 min-h-[200px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[180px]"
      />
    </div>
  );
});

MarkdownSectionEditor.displayName = 'MarkdownSectionEditor';

export default MarkdownSectionEditor;
