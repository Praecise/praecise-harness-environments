# A small real app for the computer control helpers to be tried against: a field, a
# button that saves and then goes, a line that says what happened, and a checkbox.
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

window = Gtk.Window(title="Orders")
window.set_default_size(420, 260)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin=12)
label = Gtk.Label.new_with_mnemonic("_Name")
entry = Gtk.Entry(text="old")
label.set_mnemonic_widget(entry)
said = Gtk.Label(label="Not saved.")
save = Gtk.Button(label="Save")
paid = Gtk.CheckButton(label="Paid only")


def saved(button):
    said.set_text("Saved " + entry.get_text())
    button.destroy()


save.connect("clicked", saved)
for each in (label, entry, save, said, paid):
    box.pack_start(each, False, False, 0)
window.add(box)
window.connect("destroy", Gtk.main_quit)
window.show_all()
Gtk.main()
