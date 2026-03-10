// Core
import D from './1_daimio.js'

// Third-party libs
import './lib/seedrandom.js'
import './lib/setimmediate.js'

// Segment types (order matters for lexer priority)
import './2_segtypes/a_terminator.js'
import './2_segtypes/b_number.js'
import './2_segtypes/c_string.js'
import './2_segtypes/d_block.js'
import './2_segtypes/e_blockjoin.js'
import './2_segtypes/f_pipeline.js'
import './2_segtypes/g_list.js'
import './2_segtypes/h_fancy.js'
import './2_segtypes/i_variableset.js'
import './2_segtypes/j_portsend.js'
import './2_segtypes/k_variable.js'
import './2_segtypes/l_pipevar.js'
import './2_segtypes/m_command.js'
import './2_segtypes/n_alias.js'

// Commands
import './commands/builtin/list.js'
import './commands/builtin/logic.js'
import './commands/builtin/math.js'
import './commands/builtin/process.js'
import './commands/builtin/string.js'
import './commands/builtin/time.js'
import './commands/builtin/var.js'
import './commands/local/daggr.js'
import './commands/local/dagoba.js'

// Aliases (after commands)
import './aliases/builtin.js'

// Types
import './datatypes/anything.js'
import './datatypes/array.js'
import './datatypes/block-or-string.js'
import './datatypes/block.js'
import './datatypes/integer.js'
import './datatypes/list.js'
import './datatypes/maybe-list.js'
import './datatypes/mutable-array.js'
import './datatypes/mutable-list.js'
import './datatypes/number.js'
import './datatypes/string.js'

// Pathfinders
import './pathfinders/listfinder.js'
import './pathfinders/positionfinder.js'
import './pathfinders/starfinder.js'
import './pathfinders/zkeyfinder.js'

// Optimizations (after pathfinders)
import './optimizations/constant_list.js'
import './optimizations/simple_math.js'
import './optimizations/simple_peek.js'

// Port flavours
import './pflavs/internal.js'
import './pflavs/dom-do-submit.js'
import './pflavs/dom-on-arrow.js'
import './pflavs/dom-on-blur.js'
import './pflavs/dom-on-change.js'
import './pflavs/dom-on-click.js'
import './pflavs/dom-on-keypress.js'
import './pflavs/dom-on-mouseout.js'
import './pflavs/dom-on-mouseover.js'
import './pflavs/dom-on-submit.js'
import './pflavs/dom-set-raw-html.js'
import './pflavs/dom-set-text.js'
import './pflavs/dom-set-value.js'
import './pflavs/from-js.js'
import './pflavs/socket-add-user.js'
import './pflavs/socket-in.js'
import './pflavs/socket-out.js'
import './pflavs/socket-remove-user.js'
import './pflavs/sse-receive.js'
import './pflavs/svg-add-line.js'
import './pflavs/svg-move.js'
import './pflavs/svg-rotate.js'
import './pflavs/to-js.js'
import './pflavs/xhr-send.js'

// FIRE IT UP

D.DIALECTS.top = new D.Dialect() // no params means "use whatever i've imported"
D.DIALECTS.restricted = D.make_restricted_dialect()

D.ExecutionSpace =
  new D.Space(
    D.spaceseed_add(
      {dialect: {commands:{}, aliases:{}}, stations: [], subspaces: [], ports: [], routes: [], state: {}}))

// Make D available globally for inline scripts
if (typeof window !== 'undefined')
  window.D = D

export default D
