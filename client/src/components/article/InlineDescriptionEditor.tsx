import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

interface Props {
  initialContent: string;
  onSave: (markdown: string) => Promise<void>;
  onCancel: () => void;
}

export default function InlineDescriptionEditor({ initialContent, onSave, onCancel }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: initialContent,
  });

  const handleSave = async () => {
    if (!editor) return;
    const md = editor.storage.markdown.getMarkdown() as string;
    await onSave(md.trim());
  };

  const toolbar = [
    { label: 'B',  title: 'Bold',      active: () => editor?.isActive('bold') ?? false,              action: () => editor?.chain().focus().toggleBold().run() },
    { label: 'I',  title: 'Italic',    active: () => editor?.isActive('italic') ?? false,            action: () => editor?.chain().focus().toggleItalic().run() },
    { label: 'H2', title: 'Heading 2', active: () => editor?.isActive('heading', { level: 2 }) ?? false, action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'H3', title: 'Heading 3', active: () => editor?.isActive('heading', { level: 3 }) ?? false, action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run() },
  ];

  return (
    <div className="border border-blue-300 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 bg-gray-50">
        {toolbar.map(({ label, title, active, action }) => (
          <button
            key={label}
            title={title}
            onMouseDown={(e) => { e.preventDefault(); action(); }}
            className={`px-2 py-0.5 text-xs rounded ${active() ? 'bg-gray-200 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
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

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100 bg-gray-50">
        <button
          onClick={handleSave}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
