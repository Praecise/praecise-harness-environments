// A small real app for the Windows helper to be tried against: a field, a button that
// saves and then goes, a line that says what happened, and a checkbox.
using System;
using System.Drawing;
using System.Windows.Forms;

static class Orders {
  [STAThread]
  static void Main() {
    var form = new Form { Text = "Orders", ClientSize = new Size(420, 260), StartPosition = FormStartPosition.Manual, Location = new Point(60, 60), ShowInTaskbar = true };
    var label = new Label { Text = "Name", Location = new Point(12, 12), AutoSize = true };
    var entry = new TextBox { Text = "old", Location = new Point(12, 36), Width = 396, AccessibleName = "Name" };
    var save = new Button { Text = "Save", Location = new Point(12, 70), Width = 396, Height = 30 };
    var said = new Label { Text = "Not saved.", Location = new Point(12, 110), AutoSize = true };
    var paid = new CheckBox { Text = "Paid only", Location = new Point(12, 136), AutoSize = true };
    save.Click += delegate {
      said.Text = "Saved " + entry.Text;
      form.Controls.Remove(save);
      save.Dispose();
    };
    form.Controls.AddRange(new Control[] { label, entry, save, said, paid });
    Application.Run(form);
  }
}
