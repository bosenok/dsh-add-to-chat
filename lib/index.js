// Host half of the dsh-add-to-chat plugin. The feature is entirely a client
// concern (selection → composer insertion), so this half only satisfies the
// loader entry contract and mounts nothing.
const name = "add-to-chat";

function apply() {
	// no host behaviour
}

export { apply, name };
